/**
 * 派活任务完成后的自动总结与汇报（host 半侧核心）。
 *
 * 能力链路：fatfish_session_dispatch 排队成功 → 台账落 active → 监听宿主
 * session 状态事件判定「任务完成」→ 取该会话最后一轮 assistant 回复产出总结
 * → 台账落 done → 汇报（面板任务卡 /api/dafeiyu/tasks 轮询 + IM 推送预留口）。
 *
 * ── 完成判定规则（为什么这么判）──────────────────────────────────────────
 * 1. 台账只跟踪 fatfish_session_dispatch 排队成功的会话，每会话一条活动条目；
 *    同会话重复派活覆盖任务摘要并重置基线游标（台账按会话粒度，不按派活次数）。
 * 2. 监听宿主事件 `api-session/status`（Agent 的 running 状态翻转，宿主在
 *    Agent 启停时全局 emit）。目标会话 running=false → 启动去抖定时器
 *    （SETTLE_MS=10s）；running=true → 取消在途定时器（任务还在推进）。
 *    去抖理由：多段任务排队时队列项之间有秒级空隙、工具审批/选择题会让
 *    running 短暂翻 false、主人插话也会触发启停——这些都是「假空闲」；
 *    10s 窗口足以覆盖，又不会明显推迟汇报。
 * 3. 定时器到期读 sessionController.state() 复核，三条同时成立才判完成：
 *    a. running === false（当前确实空闲）；
 *    b. queue 为空或 null（没有排队的下一段；null = 无活 Agent，配合 d 兜底）；
 *    c. pendingInput 为空（等人批准/答题是「待主人处理」，不是完成）。
 *    复核不成立且 queue 非空 → 挂 SLOW_POLL_MS=30s 慢轮询兜底（下一项被拾起
 *    时会再触发 status 事件，双保险）；复核不成立且 running 又为 true → 什么都不
 *    做，等下一次 running=false 事件重新进入去抖。
 * 4. 判定成立 → 读该会话最近历史页（sessionController.events，冷读不激活），
 *    取基线（派活时游标 baselineCursor；读取失败回退派活时刻）之后最后一条
 *    完整 assistant/message 的文本 → summarizeReply 抽结论段 → 台账落 done
 *    → 汇报。基线之后没有任何 assistant 输出 → done + note:'no-output'
 *    （诚实标注无输出，不冒充完成总结）。
 * 5. `api-session/removed`（会话归档/删除）：活动条目直接落 done +
 *    note:'session-gone'，不再跟踪。
 * 6. 等人机交互（waiting-input，主人只与管家对话的汇报面）：
 *    agent 等审批/答题时 phase 停在 running（宿主 status 只有 idle/running
 *    两值，见 Agent.status getter），不会触发任何 running=false 事件——
 *    因此对跟踪中的会话，在 running 期间挂 WATCH_POLL_MS=10s 的状态采样器
 *    （只读 state()，只对被派活的会话），发现 pendingInput 非空即落
 *    'waiting-input' 状态并汇报；采样器看到 pendingInput 清空（主人在拦截条
 *    或对话里答完）即回落 active，后续走正常完成流水线。主人在原对话里直接
 *    处理与在管家面板处理等效——都只是清空 pendingInput，管家无需区分。
 *    running=false 事件到达时采样器让位给去抖复核（verify 同样检查
 *    pendingInput，覆盖"空闲态挂起交互"的少数路径）。
 * 7. 重启对账（不误报、不丢失）：启动时载入台账，延迟 RECONCILE_DELAY_MS=20s
 *    （等宿主把会话目录与在跑会话恢复完）逐条复核未完成（active/waiting-input）：
 *    - 会话已不存在（state 读失败且不在会话目录）→ done + 'session-gone'；
 *    - running=true → 保持 active，交给事件监听（正常续跑）；
 *    - 空闲+队列空+无待交互+有基线后的 assistant 回复 → 宿主离线期间已完成
 *      → 补总结落 done（补报，不是误报：确实完成过）；
 *    - 空闲+队列空+无待交互+无任何基线后输出 → done + 'no-output'
 *      （排队提示从未被执行；挂着不判会永远悬空，诚实收案）。
 *
 * ── 总结取舍（为什么不复用 compaction）──────────────────────────────────
 * 仓库已有的摘要能力是 dsh-compaction（ctx.compaction.compactNow）：它把
 * 「更早的历史」压成摘要事件写回同一会话、并遮蔽原事件——作用面是给会话
 * 自己腾上下文，不是对外汇报；对别人的会话跑一次会污染该会话的事件流，
 * 且摘要的是旧历史而非最后一轮结论。没有可复用的「给我一段文本出摘要」的
 * 独立服务（无 LLM 直调通道），因此采用零成本启发式：取最后一轮 assistant
 * 回复的「结论段」——优先匹配 总结/结论/改动/交付/验收 等标题的小节，
 * 否则取最后一个非空段落；代码块折叠、480 字封顶。取舍已在此写明。
 *
 * ── 持久化取舍（文件而非内存）──────────────────────────────────────────
 * 台账落 ~/.dafeiyu/tasks.json（临时文件+rename 原子写）：dsh 重启/升级后
 * 内存必失，active 条目丢了就既不汇报也不再看管（丢失），done 条目丢了会
 * 把已完成任务再报一遍（误报）。单进程单写者、单表 <200 行，JSON 文件足够，
 * 不引入 SQLite。done 条目保留 LEDGER_CAP=200 条（超出丢最旧 done，永不丢
 * active）。
 * byClaude
 */
// byClaude-start
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionState } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { TaskReport } from './client/constants.js'
import { notifyTaskComplete } from './im.js'

/** 去抖窗口：running=false 后等多久再复核（见文件头判定规则 2）。 */
const SETTLE_MS = 10_000
/** 慢轮询：复核发现队列还有下一段时的兜底间隔。 */
const SLOW_POLL_MS = 30_000
/** 人机交互采样：running 期间每 10s 读一次 state()（只对跟踪中的会话）。 */
const WATCH_POLL_MS = 10_000
/** 重启对账延迟：等宿主会话目录/在跑会话恢复完。 */
const RECONCILE_DELAY_MS = 20_000
/** 台账容量上限（超出丢最旧 done，永不丢 active）。 */
const LEDGER_CAP = 200
/** 历史页读取的 messages 预算（最后一轮回复必然在最近 24 条消息里）。 */
const HISTORY_BUDGET = 24
/** 总结封顶字符数。 */
const SUMMARY_CAP = 480
/** 派活摘要（task 字段）封顶字符数。 */
const TASK_DIGEST_CAP = 160
/** state/events 单次读取超时。 */
const READ_TIMEOUT_MS = 15_000

/** 台账条目（内部态；对外投影是 TaskReport）。 */
interface TaskLedgerEntry {
  readonly sessionId: string
  readonly task: string
  readonly title?: string
  readonly dispatchedAt: number
  /** 派活时刻的会话游标（此后的事件才是本任务产出）；-1 = 读取失败未知。 */
  readonly baselineCursor: number
  status: 'active' | 'waiting-input' | 'done'
  /** waiting-input 时等的是什么（pendingInput 首项）。 */
  pendingKind?: 'approval' | 'question' | 'other'
  completedAt?: number
  summary?: string
  note?: 'session-gone' | 'no-output'
}

/** 结论段标题关键词（中英，匹配节标题去掉 # 前缀后的整行）。 */
const SUMMARY_HEADING = /^(总结|小结|结论|完成情况|改动|交付|效果|验收|总结与效果|summary|conclusion|results?|outcome|deliverables?)\s*[:：]?\s*$/i

/**
 * 从最后一轮 assistant 回复全文抽总结：
 * 1) 代码块折叠为「（代码）」；
 * 2) 有 markdown 小节标题命中结论关键词 → 取最后一个命中节（到下一节标题为止）；
 * 3) 否则取最后一个非空段落（收尾段通常就是结论）；
 * 4) 压平空白、480 字封顶。
 */
export function summarizeReply(reply: string): string {
  const stripped = reply.replace(/```[\s\S]*?```/g, '（代码）').trim()
  if (stripped === '') return ''
  const lines = stripped.split('\n')
  const headingAt: number[] = []
  const matches: number[] = []
  lines.forEach((line, index) => {
    if (!/^#{1,6}\s+\S/.test(line)) return
    headingAt.push(index)
    if (SUMMARY_HEADING.test(line.replace(/^#{1,6}\s+/, '').trim())) matches.push(index)
  })
  let core: string | undefined
  const lastMatch = matches.at(-1)
  if (lastMatch !== undefined) {
    const next = headingAt.find(index => index > lastMatch)
    core = lines.slice(lastMatch + 1, next ?? lines.length).join('\n')
  }
  if (core === undefined || core.trim() === '') {
    const paragraphs = stripped.split(/\n\s*\n/).filter(part => part.trim() !== '')
    core = paragraphs.at(-1)
  }
  const flat = (core ?? '').replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  return flat.length <= SUMMARY_CAP ? flat : flat.slice(0, SUMMARY_CAP - 1) + '…'
}

/** 历史页记录的最小探测面（data 是 JsonValue，运行时收窄）。 */
interface HistoryRecordLike {
  readonly type?: unknown
  readonly event?: {
    readonly type?: unknown
    readonly seq?: unknown
    readonly time?: unknown
    readonly data?: unknown
  } | undefined
}

/** 从 assistant/message 事件 data 里剥出文本块全文；形状不符返回 undefined。 */
function assistantTextOf(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const message = (data as { readonly message?: unknown }).message
  if (message === null || typeof message !== 'object') return undefined
  const content = (message as { readonly content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((block): block is { readonly type: string; readonly text: string } =>
      block !== null && typeof block === 'object'
      && (block as { readonly type?: unknown }).type === 'text'
      && typeof (block as { readonly text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
  return text === '' ? undefined : text
}

/**
 * 在历史页（时间正序）里找基线之后最后一条完整 assistant 回复全文。
 * 基线优先按事件 seq（单调、无时钟问题）；baselineCursor<0 时回退按
 * time >= dispatchedAt 判定（回复必然发生在派活之后）。
 */
function lastReplyAfter(
  records: readonly HistoryRecordLike[],
  entry: TaskLedgerEntry,
): string | undefined {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]
    if (record?.type !== 'event' || record.event?.type !== 'assistant/message') continue
    const { seq, time } = record.event
    const afterBaseline = entry.baselineCursor >= 0
      ? typeof seq === 'number' && seq > entry.baselineCursor
      : typeof time === 'number' && time >= entry.dispatchedAt
    if (!afterBaseline) continue
    const text = assistantTextOf(record.event.data)
    if (text !== undefined) return text
  }
  return undefined
}

/**
 * 派活完成跟踪器：台账 + 完成检测 + 总结 + 汇报触发。
 * 生命周期与插件 fiber 一致；start() 返回注销器（清监听与全部定时器）。
 */
export class TaskTracker {
  private readonly ctx: Context
  private readonly file: string
  private entries: TaskLedgerEntry[] = []
  /** 台账载入门闩：所有读改入口先等它（构造即开载，坏文件按空台账处理）。 */
  private readonly ready: Promise<void>
  /** 去抖定时器（running=false 后的复核）。 */
  private readonly settleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 慢轮询定时器（复核发现队列还有下一段时）。 */
  private readonly slowTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 人机交互采样器（running 期间观察 pendingInput；见文件头规则 6）。 */
  private readonly watchTimers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(ctx: Context) {
    this.ctx = ctx
    this.file = join(homedir(), '.dafeiyu', 'tasks.json')
    this.ready = this.load()
  }

  /** 载入台账（坏文件按空台账处理，不影响启动）。 */
  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const rows: TaskLedgerEntry[] = []
      for (const row of parsed) {
        if (row === null || typeof row !== 'object') continue
        const e = row as Partial<TaskLedgerEntry>
        if (typeof e.sessionId !== 'string' || typeof e.task !== 'string'
          || typeof e.dispatchedAt !== 'number' || typeof e.baselineCursor !== 'number'
          || (e.status !== 'active' && e.status !== 'waiting-input' && e.status !== 'done')) continue
        rows.push({
          sessionId: e.sessionId,
          task: e.task,
          ...(typeof e.title === 'string' ? { title: e.title } : {}),
          dispatchedAt: e.dispatchedAt,
          baselineCursor: e.baselineCursor,
          status: e.status,
          ...(e.pendingKind === 'approval' || e.pendingKind === 'question' || e.pendingKind === 'other'
            ? { pendingKind: e.pendingKind }
            : {}),
          ...(typeof e.completedAt === 'number' ? { completedAt: e.completedAt } : {}),
          ...(typeof e.summary === 'string' ? { summary: e.summary } : {}),
          ...(e.note === 'session-gone' || e.note === 'no-output' ? { note: e.note } : {}),
        })
      }
      this.entries = rows
    } catch {
      this.entries = []
    }
  }

  /** 原子落盘（tmp + rename）；失败只告警不抛（台账丢失可由重启对账补）。 */
  private async save(): Promise<void> {
    try {
      const dir = join(homedir(), '.dafeiyu')
      await mkdir(dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(this.entries), 'utf8')
      await rename(tmp, this.file)
    } catch (error) {
      this.ctx.logger.warn('dafeiyu: task ledger save failed: %o', error)
    }
  }

  /** 对外快照（端点与面板消费）。 */
  report(): readonly TaskReport[] {
    return this.entries.map(entry => ({
      sessionId: entry.sessionId,
      task: entry.task,
      ...(entry.title !== undefined ? { title: entry.title } : {}),
      status: entry.status,
      dispatchedAt: entry.dispatchedAt,
      ...(entry.pendingKind !== undefined ? { pendingKind: entry.pendingKind } : {}),
      ...(entry.completedAt !== undefined ? { completedAt: entry.completedAt } : {}),
      ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    }))
  }

  /** 未完成条目（active / waiting-input 都在跟踪中）。 */
  private trackedOf(sessionId: string): TaskLedgerEntry | undefined {
    return this.entries.find(entry =>
      entry.sessionId === sessionId && entry.status !== 'done')
  }

  /**
   * 派活登记：fatfish_session_dispatch 排队成功后调用。
   * 同会话重复派活 = 覆盖任务摘要、重置基线（按会话粒度跟踪）。
   */
  async recordDispatch(input: {
    readonly sessionId: string
    readonly task: string
    readonly title?: string
  }): Promise<void> {
    await this.ready
    const dispatchedAt = Date.now()
    // 基线游标尽力读：排队提示尚未入日志，此刻游标即「本任务之前」的切面。
    const baselineCursor = await this.readState(input.sessionId).then(
      state => state?.cursor ?? -1, () => -1,
    )
    this.entries = this.entries.filter(entry => entry.sessionId !== input.sessionId)
    this.entries.push({
      sessionId: input.sessionId,
      task: input.task.length > TASK_DIGEST_CAP ? input.task.slice(0, TASK_DIGEST_CAP - 1) + '…' : input.task,
      ...(input.title !== undefined && input.title.trim() !== '' ? { title: input.title.trim() } : {}),
      dispatchedAt,
      baselineCursor,
      status: 'active',
    })
    this.clearTimers(input.sessionId)
    await this.save()
    // 目标会话可能已在跑（复用会话派活）：采样器即刻挂上，防漏 waiting-input。
    this.armWatch(input.sessionId)
  }

  /** 清一个会话的全部在途定时器。 */
  private clearTimers(sessionId: string): void {
    const settle = this.settleTimers.get(sessionId)
    if (settle !== undefined) clearTimeout(settle)
    this.settleTimers.delete(sessionId)
    this.clearSlowPoll(sessionId)
    this.clearWatch(sessionId)
  }

  /** 真取消一个会话的慢轮询（清定时器 + 删登记）。 */
  private clearSlowPoll(sessionId: string): void {
    const slow = this.slowTimers.get(sessionId)
    if (slow !== undefined) clearTimeout(slow)
    this.slowTimers.delete(sessionId)
  }

  /** 真取消人机交互采样器。 */
  private clearWatch(sessionId: string): void {
    const watch = this.watchTimers.get(sessionId)
    if (watch !== undefined) clearInterval(watch)
    this.watchTimers.delete(sessionId)
  }

  /** 读被动状态；读取失败（含会话不存在）返回 undefined。 */
  private async readState(sessionId: string): Promise<SessionState | undefined> {
    try {
      return await this.ctx.sessionController.state(
        { sessionId: SessionId(sessionId) },
        AbortSignal.timeout(READ_TIMEOUT_MS),
      )
    } catch {
      return undefined
    }
  }

  /** 读最近历史页；失败返回 undefined。 */
  private async readHistory(sessionId: string): Promise<readonly HistoryRecordLike[] | undefined> {
    try {
      const page = await this.ctx.sessionController.events(
        { address: { kind: 'session', sessionId: SessionId(sessionId) }, maxMessages: HISTORY_BUDGET },
        AbortSignal.timeout(READ_TIMEOUT_MS),
      )
      return page.records as readonly HistoryRecordLike[]
    } catch {
      return undefined
    }
  }

  /** 完成三条件（见文件头判定规则 3）。 */
  private static isSettled(state: SessionState): boolean {
    return state.running !== true
      && (state.queue === null || state.queue.length === 0)
      && state.pendingInput.length === 0
  }

  /** 定时器到期后的复核入口（去抖终点）。 */
  private readonly settleCheck = (sessionId: string): void => {
    this.settleTimers.delete(sessionId)
    void this.verify(sessionId)
  }

  /** running=false 事件 → 进入去抖窗口。 */
  private armSettle(sessionId: string): void {
    const pending = this.settleTimers.get(sessionId)
    if (pending !== undefined) clearTimeout(pending)
    // 慢轮询与采样器一并真取消（只删 map 会留孤儿定时器，绕过 10s 去抖提前收案）。
    this.clearSlowPoll(sessionId)
    this.clearWatch(sessionId)
    this.settleTimers.set(sessionId, setTimeout(() => this.settleCheck(sessionId), SETTLE_MS))
  }

  /**
   * 挂人机交互采样器（running 期间）：agent 等审批/答题时 phase 停在 running，
   * 没有任何状态事件可听，只能周期读 state() 观察 pendingInput——只对跟踪中
   * 的会话开，代价是每 10s 一次被动读。发现 pendingInput → 落 waiting-input
   * 并汇报；pendingInput 清空（主人在拦截条或原对话里答完）→ 回落 active。
   * 会话不再 running 或条目收案时自摘（running=false 事件路径也会摘）。
   */
  private armWatch(sessionId: string): void {
    if (this.watchTimers.has(sessionId)) return
    const timer = setInterval(() => { void this.watchTick(sessionId) }, WATCH_POLL_MS)
    this.watchTimers.set(sessionId, timer)
  }

  /** 采样器单拍：观察 pendingInput 增减并落状态。 */
  private async watchTick(sessionId: string): Promise<void> {
    const entry = this.trackedOf(sessionId)
    if (entry === undefined || entry.status === 'done') {
      this.clearWatch(sessionId)
      return
    }
    const state = await this.readState(sessionId)
    if (state === undefined || this.trackedOf(sessionId) !== entry) return
    if (!state.running) {
      // 不再跑：交给去抖/事件流水线，采样器退场。
      this.clearWatch(sessionId)
      return
    }
    if (state.pendingInput.length > 0) {
      if (entry.status !== 'waiting-input') await this.markWaiting(sessionId, entry, state.pendingInput[0] ?? 'other')
      return
    }
    if (entry.status === 'waiting-input') await this.markWaiting(sessionId, entry, undefined)
  }

  /** 落/清 waiting-input 状态（undefined = 回落 active）并持久化。 */
  private async markWaiting(sessionId: string, entry: TaskLedgerEntry, kind: 'approval' | 'question' | 'other' | undefined): Promise<void> {
    const next: TaskLedgerEntry = kind === undefined
      ? { ...entry, status: 'active', pendingKind: undefined }
      : { ...entry, status: 'waiting-input', pendingKind: kind }
    this.entries = this.entries.map(row => row === entry ? next : row)
    await this.save()
    this.ctx.logger.info(
      'dafeiyu: task %s %s',
      sessionId, kind === undefined ? 'resumed (input answered)' : `waiting for ${kind}`,
    )
  }

  /** 慢轮询：队列还有下一段（或状态暂时读不出）时兜底再核。 */
  private armSlowPoll(sessionId: string): void {
    if (this.slowTimers.has(sessionId)) return
    this.slowTimers.set(sessionId, setTimeout(() => {
      this.slowTimers.delete(sessionId)
      void this.verify(sessionId)
    }, SLOW_POLL_MS))
  }

  /** 复核一个活动条目：满足三条件 → 完成收案；否则按情形续等。 */
  private async verify(sessionId: string): Promise<void> {
    await this.ready
    const entry = this.trackedOf(sessionId)
    if (entry === undefined) {
      this.clearTimers(sessionId)
      return
    }
    const state = await this.readState(sessionId)
    // await 期间同会话可能被重新派活（recordDispatch 换了新条目对象）：
    // 身份不一致说明本轮复核已过期，直接放弃（新任务有自己的事件流水）。
    if (this.trackedOf(sessionId) !== entry) return
    if (state === undefined) {
      // 状态读不出：可能是瞬时故障，慢轮询再核；连续失败由重启对账收案。
      this.armSlowPoll(sessionId)
      return
    }
    if (state.running) return // 任务又在跑：等下一次 running=false 事件。
    if (state.pendingInput.length > 0) {
      // 空闲态挂起交互（少数路径：主路径是 running 期间由采样器发现）：
      // 落 waiting-input 并慢轮询盯着，主人答完恢复流水线。
      if (entry.status !== 'waiting-input') await this.markWaiting(sessionId, entry, state.pendingInput[0] ?? 'other')
      this.armSlowPoll(sessionId)
      return
    }
    if (!TaskTracker.isSettled(state)) {
      // 队列还有下一段：慢轮询兜底；拾起时会再触发启停事件。
      this.armSlowPoll(sessionId)
      return
    }
    await this.complete(sessionId, entry)
  }

  /**
   * 完成收案：抽总结 → 落 done → 汇报。
   * 基线后无 assistant 输出 → note:'no-output'（不冒充完成总结）。
   */
  private async complete(sessionId: string, entry: TaskLedgerEntry): Promise<void> {
    this.clearTimers(sessionId)
    const records = await this.readHistory(sessionId)
    // readHistory 也是 await：落 done 前再核一次条目身份，防把刚重派的新任务误判完成。
    if (this.trackedOf(sessionId) !== entry) return
    const reply = records === undefined ? undefined : lastReplyAfter(records, entry)
    const summary = reply === undefined ? undefined : summarizeReply(reply)
    const done: TaskLedgerEntry = {
      ...entry,
      status: 'done',
      pendingKind: undefined,
      completedAt: Date.now(),
      ...(reply === undefined ? { note: 'no-output' as const } : (summary === '' ? {} : { summary })),
    }
    this.entries = this.entries.map(row => row.sessionId === sessionId ? done : row)
    this.trimToCap()
    await this.save()
    this.ctx.logger.info(
      'dafeiyu: task done %s (%s)%s',
      sessionId, entry.task.slice(0, 40),
      summary !== undefined ? '' : ' [no summary]',
    )
    // 汇报通道：面板轮询 /api/dafeiyu/tasks 拿快照；IM 推送走预留口（本期只落日志）。
    const report = this.report().find(row => row.sessionId === sessionId)
    if (report !== undefined) await notifyTaskComplete(report).catch(() => undefined)
  }

  /** 会话消失（归档/删除）：活动条目直接收案。 */
  private async completeGone(sessionId: string): Promise<void> {
    await this.ready
    const entry = this.trackedOf(sessionId)
    if (entry === undefined) return
    this.clearTimers(sessionId)
    const done: TaskLedgerEntry = { ...entry, status: 'done', pendingKind: undefined, completedAt: Date.now(), note: 'session-gone' }
    this.entries = this.entries.map(row => row.sessionId === sessionId ? done : row)
    this.trimToCap()
    await this.save()
  }

  /** done 超容量时丢最旧 done（active 永不丢）。 */
  private trimToCap(): void {
    if (this.entries.length <= LEDGER_CAP) return
    const doneSorted = this.entries
      .filter(row => row.status === 'done')
      .sort((left, right) => (left.completedAt ?? 0) - (right.completedAt ?? 0))
    let overflow = this.entries.length - LEDGER_CAP
    if (doneSorted.length === 0) return
    const drop = new Set<string>()
    for (const row of doneSorted) {
      if (overflow <= 0) break
      drop.add(row.sessionId)
      overflow -= 1
    }
    this.entries = this.entries.filter(row => !drop.has(row.sessionId))
  }

  /**
   * 重启对账：见文件头判定规则 7。对未完成（active/waiting-input）条目收案或续跟。
   */
  private async reconcile(): Promise<void> {
    await this.ready
    const tracked = this.entries.filter(row => row.status !== 'done').map(row => row.sessionId)
    for (const sessionId of tracked) {
      const entry = this.trackedOf(sessionId)
      if (entry === undefined) continue
      const state = await this.readState(sessionId)
      if (state === undefined) {
        const listed = await this.ctx.sessionController.list({}, AbortSignal.timeout(READ_TIMEOUT_MS))
          .then(rows => rows.items.some(row => row.sessionId === sessionId))
          .catch(() => true) // 列表也读不出时不武断收案，保持未完成。
        if (!listed) await this.completeGone(sessionId)
        continue
      }
      if (state.running) {
        // 续跑：交给事件监听；采样器即刻挂上，防漏等待交互。
        this.armWatch(sessionId)
        continue
      }
      if (state.pendingInput.length > 0) {
        // 空闲态还挂着交互：落 waiting-input，慢轮询盯恢复。
        if (entry.status !== 'waiting-input') await this.markWaiting(sessionId, entry, state.pendingInput[0] ?? 'other')
        this.armSlowPoll(sessionId)
        continue
      }
      if (!TaskTracker.isSettled(state)) {
        // 队列还有货：重新挂上慢轮询，让正常流水线接管。
        this.armSlowPoll(sessionId)
        continue
      }
      // 空闲且无待处理：离线期间要么做完要么从未跑起——都按完成收案（无输出时诚实注记）。
      await this.complete(sessionId, entry)
    }
  }

  /**
   * 启动监听：状态事件 + 会话消失 + 延迟对账。
   * @returns 注销器（清监听与全部定时器；fiber 语义下双保险）。
   */
  start(): () => void {
    const disposers: Array<() => void> = []
    disposers.push(this.ctx.on('api-session/status', (sessionId, running) => {
      const id = String(sessionId)
      if (this.trackedOf(id) === undefined) return
      if (running) {
        // 任务推进中：取消在途去抖与慢轮询（若有）——真正的去抖起点永远是
        // 下一次 running=false 事件，兜底定时器不允许抢跑收案。
        const settle = this.settleTimers.get(id)
        if (settle !== undefined) clearTimeout(settle)
        this.settleTimers.delete(id)
        this.clearSlowPoll(id)
        // running 期间挂人机交互采样器（等审批不发状态事件，见文件头规则 6）。
        this.armWatch(id)
      } else {
        this.armSettle(id)
      }
    }))
    disposers.push(this.ctx.on('api-session/removed', sessionId => {
      const id = String(sessionId)
      if (this.trackedOf(id) === undefined) return
      void this.completeGone(id)
    }))
    // 会话可见/恢复（重启后 Agent 重建）：挂一次复核，让未完成条目接回流水线。
    disposers.push(this.ctx.on('api-session/added', summary => {
      const id = String(summary.sessionId)
      if (this.trackedOf(id) === undefined) return
      this.armSlowPoll(id)
    }))
    const reconcileTimer = setTimeout(() => { void this.reconcile() }, RECONCILE_DELAY_MS)
    return () => {
      clearTimeout(reconcileTimer)
      for (const sessionId of [...this.settleTimers.keys(), ...this.slowTimers.keys(), ...this.watchTimers.keys()]) {
        this.clearTimers(sessionId)
      }
      for (const dispose of disposers) dispose()
    }
  }
}

/**
 * 注册 /api/dafeiyu/tasks 精确路由（GET）：返回台账快照给面板轮询。
 * 结构与 registerImEndpoint 同款（connection.fetch.register，owner 鉴权；
 * connection 缺席时静默退场，面板拿 null 自动隐藏本能力）。
 */
export function registerTasksEndpoint(ctx: Context, tracker: TaskTracker): void {
  ctx.inject(['connection'], scoped => {
    const connection = (scoped as unknown as {
      readonly connection?: {
        readonly fetch?: { readonly register?: (route: unknown) => Promise<() => Promise<void>> }
      }
    }).connection
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return
    const route = {
      // 路由键是含 /api 前缀的完整路径（fetchRoutes 按请求 pathname 精确匹配）。
      path: '/api/dafeiyu/tasks',
      methods: ['GET'],
      // ConnectionFetchRoute 契约必填（缺省会被 http-bridge 拒成 400）；GET 无体也按 buffered 声明（im 端点同款）。
      requestBody: 'buffered',
      fetch: async (): Promise<Response> => {
        try {
          return Response.json({ ok: true, tasks: tracker.report() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ ok: false, message }, { status: 500 })
        }
      },
    }
    void register(route).then(dispose => {
      scoped.effect(() => () => { void dispose() }, 'dafeiyu: tasks endpoint route')
    }, (error: unknown) => {
      scoped.logger.warn('dafeiyu: tasks endpoint route rejected: %o', error)
    })
  })
}
// byClaude-end
