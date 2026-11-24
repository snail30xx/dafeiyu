/**
 * 管家自主循环（host 半侧）：定时巡检 ONES 三个项目（vbs/vos/vas）的需求数，
 * 新需求（uuid 首次出现）落提议台账并推钉钉；主人在面板批准后派活到
 * vos-agent-dev 工作区的会话跑 req-dev-pipeline——「眼里有活找活干，替主人
 * 做提议，不替主人做决定」。
 *
 * ── 巡检口径（为什么这么判）────────────────────────────────────────────
 * 1. 查询面：spawn `vos2 ot --list --project <p> --json`（vos-agent-dev 的
 *    现成 CLI，token 管理复用其认证，不重复造）。输出 items:[{number,name,
 *    uuid,status,project}]；列表是最近 50 条滑动窗口，混着所有状态。
 * 2. 新建判定 = uuid 差分（首次出现即新建）：新 uuid 刚进窗口必然是初始状态，
 *    不再叠加状态过滤（老需求因关联任务第一次进窗口也会触发——提议制，主人
 *    忽略即可，宁多勿漏）。
 * 3. seen 集 ~/.dafeiyu/ones-seen.json 只增不减：窗口滑出的老需求不移除，
 *    长时间后再见到不会误报「新建」。首次巡检（seen 无该项目）只种子化基线
 *    不提议——防止 daemon 首启把存量 50 条全当新需求轰炸主人。
 * 4. 提议去重由 ProposalStore 的稳定 ID（ones:<project>:<uuid>）保证：主人
 *    ignored 后再撞见也不打扰。
 * 5. 静音时段只静推送不静巡检：提议照落台账（面板可见），钉钉不响。
 * 6. 心跳落盘 ~/.dafeiyu/autonomy-status.json（可观测性）：每轮巡检成败都写
 *    （含每项目 lastOkAt/lastError 与推送通道）——桌面宿主不持久化任何日志，
 *    空转循环零落盘时「没活」与「死了」无从分辨；面板经 proposals 端点读它。
 *
 * ── 派活（approve 回调）──────────────────────────────────────────────
 * 每日派活上限（默认 3）在派活前检查；会话在配置的 cwd（默认 vos-agent-dev
 * 仓库）下创建——该目录的 .agents/skills 自然加载，prompt 点名 req-dev-pipeline
 * 技能与铁律（gate 一律人机交互，禁止静默等待）。派活复用 dispatch 内核：
 * create → rename → prompt(queue) → tracker.recordDispatch，之后的完成检测、
 * waiting-input 拦截、总结、钉钉回执全部由 tasks.ts 现有流水线接管。
 * byClaude
 */
// byClaude-start
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { ProposalReport } from './client/constants.js'
import type { AutonomyProjectStatus, AutonomyStatus } from './client/constants.js'
import { imPushChannel, pushDingtalk } from './im.js'
import type { ProposalStore } from './proposals.js'
import type { TaskTracker } from './tasks.js'

const mintRequestId = (raw: string): SessionRequestId => raw as SessionRequestId

/** 心跳文件路径：~/.dafeiyu/autonomy-status.json（host 写，proposals 端点读）。 */
const AUTONOMY_STATUS_FILE = join(homedir(), '.dafeiyu', 'autonomy-status.json')

/**
 * 读心跳文件（proposals 端点用）：坏文件 / 缺字段返回 undefined，不抛错。
 * 只做骨架校验（startedAt 数字 + projects 对象），字段级容错交给消费方。
 */
export async function readAutonomyStatus(): Promise<AutonomyStatus | undefined> {
  try {
    const raw = await readFile(AUTONOMY_STATUS_FILE, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const record = parsed as Partial<AutonomyStatus>
    if (typeof record.startedAt !== 'number' || record.projects === null
      || typeof record.projects !== 'object') return undefined
    return record as AutonomyStatus
  } catch {
    return undefined
  }
}

/** 首轮巡检延迟：启动后稍等宿主安静下来再种子化基线。 */
const FIRST_SCOUT_DELAY_MS = 60_000
/** 单次 vos2 查询超时。 */
const QUERY_TIMEOUT_MS = 90_000
/** seen 集每项目容量（超出丢最旧 firstSeen；列表窗口只有 50，500 绰绰有余）。 */
const SEEN_CAP_PER_PROJECT = 500
/** 项目名白名单（spawn shell:true 的参数注入防线）。 */
const PROJECT_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/

/** ONES 需求巡检配置。 */
interface OnesScoutConfig {
  readonly enabled: boolean
  /** ONES 项目别名列表（vos2 ot --project 接受别名/项目名/uuid）。 */
  readonly projects: readonly string[]
  readonly intervalMinutes: number
  /** 查询命令（默认 vos2；本机 PATH 可达）。 */
  readonly command: string
}

/** 自主性总配置（~/.dafeiyu/autonomy.json，坏文件/缺失按默认）。 */
export interface AutonomyConfig {
  readonly ones: OnesScoutConfig
  /** 批准后派活落点：cwd 指向 vos-agent-dev 仓库（技能目录所在地）。 */
  readonly dispatch: {
    readonly cwd: string
    readonly promptTemplate: string
  }
  /** 每日（本地自然日）最多自动派活数。 */
  readonly dailyDispatchLimit: number
  /** 钉钉推送静音时段（本地时间 HH:MM，支持跨午夜如 23:00→08:00）。 */
  readonly quietHours: { readonly start: string; readonly end: string }
}

/** 默认派活 prompt：占位符 {project} {uuid} {title}。 */
const DEFAULT_PROMPT_TEMPLATE = [
  '请用 req-dev-pipeline 技能处理一条 ONES 需求并走完需求开发流水线：',
  '- 项目:{project}',
  '- 任务 uuid:{uuid}（可用 vos2 ot --task-uuid {uuid} 拉详情）',
  '- 标题:{title}',
  '先按技能规范初始化流水线，之后严格按 SKILL.md 铁律逐节点推进；',
  '所有等待用户的节点一律使用人机交互工具（AskUserQuestion），禁止发完文本静默等待。',
].join('\n')

const DEFAULT_CONFIG: AutonomyConfig = {
  // 注意：vas 项目在 ONES 枚举里无「vas」短别名（vos2 ot --project vas 会抛错），
  // 必须用 uuid（【标】VAS-财务账务系统）；vbs/vos 两个短别名可用。
  ones: { enabled: true, projects: ['vbs', 'vos', '7mRHdFBMDzZs8r6s'], intervalMinutes: 30, command: 'vos2' },
  dispatch: { cwd: join('D:', 'wks-vos', 'vos-agent-dev'), promptTemplate: DEFAULT_PROMPT_TEMPLATE },
  dailyDispatchLimit: 3,
  quietHours: { start: '23:00', end: '08:00' },
}

/**
 * 读取自主性配置：文件缺失 / 坏 JSON / 字段类型不对一律回退默认值（字段级合并，
 * 配了哪个用哪个）。
 */
export async function readAutonomyConfig(): Promise<AutonomyConfig> {
  try {
    const raw = await readFile(join(homedir(), '.dafeiyu', 'autonomy.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_CONFIG
    const record = parsed as Record<string, unknown>
    const ones = record.ones
    const dispatch = record.dispatch
    const quiet = record.quietHours
    const onesRecord = ones !== null && typeof ones === 'object' ? ones as Record<string, unknown> : {}
    const dispatchRecord = dispatch !== null && typeof dispatch === 'object' ? dispatch as Record<string, unknown> : {}
    const quietRecord = quiet !== null && typeof quiet === 'object' ? quiet as Record<string, unknown> : {}
    const projects = Array.isArray(onesRecord.projects)
      ? onesRecord.projects.filter((item): item is string => typeof item === 'string' && PROJECT_PATTERN.test(item))
      : undefined
    return {
      ones: {
        enabled: typeof onesRecord.enabled === 'boolean' ? onesRecord.enabled : DEFAULT_CONFIG.ones.enabled,
        projects: projects !== undefined && projects.length > 0 ? projects : DEFAULT_CONFIG.ones.projects,
        intervalMinutes: typeof onesRecord.intervalMinutes === 'number' && onesRecord.intervalMinutes >= 5
          ? Math.floor(onesRecord.intervalMinutes) : DEFAULT_CONFIG.ones.intervalMinutes,
        command: typeof onesRecord.command === 'string' && onesRecord.command.trim() !== ''
          ? onesRecord.command.trim() : DEFAULT_CONFIG.ones.command,
      },
      dispatch: {
        cwd: typeof dispatchRecord.cwd === 'string' && dispatchRecord.cwd.trim() !== ''
          ? dispatchRecord.cwd.trim() : DEFAULT_CONFIG.dispatch.cwd,
        promptTemplate: typeof dispatchRecord.promptTemplate === 'string' && dispatchRecord.promptTemplate.trim() !== ''
          ? dispatchRecord.promptTemplate : DEFAULT_CONFIG.dispatch.promptTemplate,
      },
      dailyDispatchLimit: typeof record.dailyDispatchLimit === 'number' && record.dailyDispatchLimit >= 0
        ? Math.floor(record.dailyDispatchLimit) : DEFAULT_CONFIG.dailyDispatchLimit,
      quietHours: {
        start: typeof quietRecord.start === 'string' && quietRecord.start.trim() !== '' ? quietRecord.start.trim() : DEFAULT_CONFIG.quietHours.start,
        end: typeof quietRecord.end === 'string' && quietRecord.end.trim() !== '' ? quietRecord.end.trim() : DEFAULT_CONFIG.quietHours.end,
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

/** vos2 ot --list 输出的 items 行形状（运行时收窄）。 */
interface OnesItemLike {
  readonly number?: unknown
  readonly name?: unknown
  readonly uuid?: unknown
  readonly status?: unknown
}

/** seen 集：{ [project]: { [uuid]: firstSeenAt } }。 */
type SeenFile = Record<string, Record<string, number>>

/**
 * 自主循环：ONES 巡检 + 提议 + 批准派活。
 * 生命周期与插件 fiber 一致；start() 返回注销器。
 */
export class AutonomyLoop {
  private readonly ctx: Context
  private readonly store: ProposalStore
  private readonly tracker: TaskTracker
  private config: AutonomyConfig = DEFAULT_CONFIG
  private seen: SeenFile = {}
  /** 巡检互斥（上一轮没跑完不叠跑）。 */
  private scouting = false
  /** 心跳内存态：随每轮巡检更新并落盘（见 writeStatus）。 */
  private startedAt = 0
  private lastScoutAt: number | undefined
  private projectStatus: Record<string, AutonomyProjectStatus> = {}
  /** 巡检定时器（首轮回合 + 周期回合）：面板开关运行时增删。 */
  private scoutTimer: ReturnType<typeof setTimeout> | undefined
  private scoutInterval: ReturnType<typeof setInterval> | undefined

  constructor(ctx: Context, store: ProposalStore, tracker: TaskTracker) {
    this.ctx = ctx
    this.store = store
    this.tracker = tracker
  }

  /** 启动：载配置与 seen 基线 → 心跳落盘 → 首轮延迟巡检 → 周期巡检。 */
  start(): () => void {
    const boot = async (): Promise<void> => {
      this.config = await readAutonomyConfig()
      this.seen = await this.loadSeen()
      this.startedAt = Date.now()
      if (!this.config.ones.enabled) {
        await this.writeStatus() // 关停也要留痕：面板能看出「被配置关了」而非「死了」
        return
      }
      this.armSchedule()
      await this.writeStatus()
    }
    void boot().catch((error: unknown) => {
      this.ctx.logger.warn('dafeiyu: autonomy boot failed: %o', error)
    })
    return () => {
      if (this.scoutTimer !== undefined) clearTimeout(this.scoutTimer)
      if (this.scoutInterval !== undefined) clearInterval(this.scoutInterval)
    }
  }

  /** （重）挂巡检定时器：先清旧再挂——首轮延迟 + 周期回合。 */
  private armSchedule(): void {
    if (this.scoutTimer !== undefined) clearTimeout(this.scoutTimer)
    if (this.scoutInterval !== undefined) clearInterval(this.scoutInterval)
    this.scoutTimer = setTimeout(() => { void this.scoutOnce() }, FIRST_SCOUT_DELAY_MS)
    this.scoutInterval = setInterval(() => { void this.scoutOnce() }, this.config.ones.intervalMinutes * 60_000)
  }

  /**
   * 面板开关（POST /api/dafeiyu/proposals action=autonomy）：改 ones.enabled 并
   * 持久化回 autonomy.json，立即生效——开 = 重挂定时器（首轮 60s 内），关 = 摘掉
   * 定时器 + 关停留痕心跳。同值幂等直接成功。
   */
  async setEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
    if (enabled === this.config.ones.enabled) return { ok: true }
    this.config = { ...this.config, ones: { ...this.config.ones, enabled } }
    try {
      await mkdir(join(homedir(), '.dafeiyu'), { recursive: true })
      const file = join(homedir(), '.dafeiyu', 'autonomy.json')
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf8')
      await rename(tmp, file)
    } catch (error) {
      this.ctx.logger.warn('dafeiyu: autonomy config save failed: %o', error)
      return { ok: false, message: 'failed to persist autonomy.json' }
    }
    if (enabled) {
      this.armSchedule()
    } else {
      if (this.scoutTimer !== undefined) clearTimeout(this.scoutTimer)
      if (this.scoutInterval !== undefined) clearInterval(this.scoutInterval)
    }
    await this.writeStatus()
    return { ok: true }
  }

  /**
   * 心跳落盘（tmp + rename 原子写，失败只告警）：每轮巡检成败、boot、派活后调用。
   * dailyDispatched 现算（store.dispatchedSince 今日零点），不另维护计数器。
   */
  private async writeStatus(): Promise<void> {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const pushChannel = imPushChannel()
    const status: AutonomyStatus = {
      enabled: this.config.ones.enabled,
      startedAt: this.startedAt,
      intervalMinutes: this.config.ones.intervalMinutes,
      inQuietHours: this.inQuietHours(),
      dailyDispatchLimit: this.config.dailyDispatchLimit,
      dailyDispatched: await this.store.dispatchedSince(todayStart.getTime()).catch(() => 0),
      projects: this.projectStatus,
      ...(this.lastScoutAt !== undefined
        ? { lastScoutAt: this.lastScoutAt, nextScoutAt: this.lastScoutAt + this.config.ones.intervalMinutes * 60_000 }
        : {}),
      ...(pushChannel !== undefined ? { pushChannel } : {}),
    }
    try {
      await mkdir(join(homedir(), '.dafeiyu'), { recursive: true })
      const tmp = `${AUTONOMY_STATUS_FILE}.tmp`
      await writeFile(tmp, JSON.stringify(status), 'utf8')
      await rename(tmp, AUTONOMY_STATUS_FILE)
    } catch (error) {
      this.ctx.logger.warn('dafeiyu: autonomy status save failed: %o', error)
    }
  }

  /** 一轮巡检：逐项目查询 → 差分 → 提议 + 推送；finally 心跳落盘（成败都写）。 */
  private async scoutOnce(): Promise<void> {
    if (this.scouting || !this.config.ones.enabled) return // 开关刚关掉：残留定时器不再发起
    this.scouting = true
    this.lastScoutAt = Date.now()
    try {
      for (const project of this.config.ones.projects) {
        if (!PROJECT_PATTERN.test(project)) continue
        await this.scoutProject(project)
      }
    } finally {
      this.scouting = false
      await this.writeStatus()
    }
  }

  /** 单项目巡检：查询 → 差分新 uuid → 提议（首见只建基线）；成败都记心跳。 */
  private async scoutProject(project: string): Promise<void> {
    const result = await this.queryOnes(project)
    if (!result.ok) {
      // 查询失败：本轮跳过，seen 不动（下轮再试）；心跳记失败摘要，保留上次 lastOkAt。
      this.projectStatus[project] = { ...this.projectStatus[project], lastError: result.message.slice(0, 200) }
      return
    }
    const items = result.items
    this.projectStatus[project] = { lastOkAt: Date.now(), itemCount: items.length }
    const known = this.seen[project] ?? {}
    const firstSight = Object.keys(known).length === 0
    let changed = false
    for (const item of items) {
      const uuid = typeof item.uuid === 'string' ? item.uuid : undefined
      if (uuid === undefined || uuid === '') continue
      if (known[uuid] !== undefined) continue
      known[uuid] = Date.now()
      changed = true
      if (firstSight) continue // 种子化基线：存量不提议
      const name = typeof item.name === 'string' ? item.name : uuid
      const status = typeof item.status === 'string' ? item.status : ''
      const numberText = typeof item.number === 'number' ? `#${item.number}` : ''
      const detail = [status, numberText, uuid].filter(part => part !== '').join(' · ')
      const created = await this.store.add({
        id: `ones:${project}:${uuid}`,
        kind: 'ones-requirement',
        title: name,
        detail,
      })
      if (!created) continue // 台账已有（曾提议过）：只补 seen，不再打扰
      this.ctx.logger.info('dafeiyu: new requirement proposal %s %s', project, name)
      if (!this.inQuietHours()) {
        await pushDingtalk(
          `新需求:${name.slice(0, 60)}`,
          `**[大肥鱼] 发现新需求(${project})**\n\n**${name}**\n\n${detail}\n\n到大肥鱼面板的「管家提议」批准或忽略`,
        ).catch(() => undefined)
      }
    }
    if (changed) {
      this.seen[project] = trimSeen(known, SEEN_CAP_PER_PROJECT)
      await this.saveSeen()
    }
  }

  /** spawn 查询并剥出 items；任何失败返回错误摘要（不误判、不误提议）。 */
  private async queryOnes(project: string): Promise<
    | { readonly ok: true; readonly items: readonly OnesItemLike[] }
    | { readonly ok: false; readonly message: string }
  > {
    const command = this.config.ones.command
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        // shell:true：Windows 下 vos2 常是 .cmd/.exe 脚本；project 已过白名单，command 来自本机配置文件（信任边界内）。
        const child = spawn(`${command} ot --list --project ${project} --json`, {
          shell: true,
          windowsHide: true,
          timeout: QUERY_TIMEOUT_MS,
        })
        let out = ''
        child.stdout.on('data', chunk => { out += String(chunk) })
        child.on('error', reject)
        child.on('close', code => { code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)) })
      })
      const items = extractItems(stdout)
      if (items === undefined) return { ok: false, message: 'vos2 输出无法解析出 items JSON' }
      return { ok: true, items }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('dafeiyu: ones query failed (%s): %o', project, error)
      return { ok: false, message }
    }
  }

  /**
   * 批准后的派活执行（proposals 端点回调）：
   * 每日上限检查 → cwd 会话创建 → 排队 prompt → 台账登记。
   */
  async dispatchProposal(proposal: ProposalReport): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }> {
    // 稳定 ID 反解 project / uuid（ones:<project>:<uuid>）。
    const parts = proposal.id.split(':')
    const project = parts[1]
    const uuid = parts.slice(2).join(':')
    if (proposal.kind !== 'ones-requirement' || parts[0] !== 'ones'
      || project === undefined || project === '' || uuid === '') {
      return { ok: false, message: `unsupported proposal kind: ${proposal.kind}` }
    }
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const dispatched = await this.store.dispatchedSince(todayStart.getTime())
    if (dispatched >= this.config.dailyDispatchLimit) {
      return { ok: false, message: `daily dispatch limit reached (${this.config.dailyDispatchLimit}); approve tomorrow or raise autonomy.json dailyDispatchLimit` }
    }
    const text = this.config.dispatch.promptTemplate
      .replaceAll('{project}', project)
      .replaceAll('{uuid}', uuid)
      .replaceAll('{title}', proposal.title)
    const title = `需求开发·${proposal.title.slice(0, 40)}`
    try {
      const made = await this.ctx.sessionController.create({ cwd: this.config.dispatch.cwd })
      const sessionId = made.sessionId
      await this.ctx.sessionController.rename({ sessionId: SessionId(sessionId), title }).catch(() => undefined)
      await this.ctx.sessionController.prompt({
        requestId: mintRequestId(crypto.randomUUID()),
        sessionId: SessionId(sessionId),
        mode: 'queue',
        content: [{ type: 'text', text }],
      }, AbortSignal.timeout(15_000))
      await this.tracker.recordDispatch({ sessionId, task: text, title }).catch(() => undefined)
      this.ctx.logger.info('dafeiyu: proposal dispatched %s -> %s', proposal.id, sessionId)
      void this.writeStatus() // 派活后立即刷新心跳的 dailyDispatched（不等下一轮巡检）
      return { ok: true, sessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message: `dispatch failed: ${message}` }
    }
  }

  /** 静音时段判定（本地时间，支持跨午夜区间）。 */
  private inQuietHours(): boolean {
    const { start, end } = this.config.quietHours
    const startMinutes = parseClock(start)
    const endMinutes = parseClock(end)
    if (startMinutes === undefined || endMinutes === undefined) return false
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return startMinutes > endMinutes
      ? nowMinutes >= startMinutes || nowMinutes < endMinutes
      : nowMinutes >= startMinutes && nowMinutes < endMinutes
  }

  /** 载入 seen 集（坏文件按空）。 */
  private async loadSeen(): Promise<SeenFile> {
    try {
      const raw = await readFile(join(homedir(), '.dafeiyu', 'ones-seen.json'), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return {}
      const seen: SeenFile = {}
      for (const [project, uuids] of Object.entries(parsed as Record<string, unknown>)) {
        if (uuids === null || typeof uuids !== 'object') continue
        const map: Record<string, number> = {}
        for (const [uuid, at] of Object.entries(uuids as Record<string, unknown>)) {
          if (typeof at === 'number') map[uuid] = at
        }
        seen[project] = map
      }
      return seen
    } catch {
      return {}
    }
  }

  /** 原子落盘 seen 集（tmp + rename）。 */
  private async saveSeen(): Promise<void> {
    try {
      const dir = join(homedir(), '.dafeiyu')
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'ones-seen.json')
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify(this.seen), 'utf8')
      await rename(tmp, file)
    } catch (error) {
      this.ctx.logger.warn('dafeiyu: ones-seen save failed: %o', error)
    }
  }
}

/** 从 vos2 ot --list 的 stdout 剥 items：先整体 parse，失败再截 {…} 片段（容忍 CLI 混入日志行）。 */
function extractItems(stdout: string): readonly OnesItemLike[] | undefined {
  const candidates = [stdout.trim()]
  const first = stdout.indexOf('{')
  const last = stdout.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(stdout.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed === null || typeof parsed !== 'object') continue
      const items = (parsed as { readonly items?: unknown }).items
      if (Array.isArray(items)) return items as readonly OnesItemLike[]
    } catch { /* 试下一个候选 */ }
  }
  return undefined
}

/** 'HH:MM' → 分钟数；不合法返回 undefined。 */
function parseClock(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/** seen 集按 firstSeen 丢最旧，保每项目容量。 */
function trimSeen(map: Record<string, number>, cap: number): Record<string, number> {
  const entries = Object.entries(map)
  if (entries.length <= cap) return map
  entries.sort((left, right) => left[1] - right[1])
  const keep = entries.slice(entries.length - cap)
  const next: Record<string, number> = {}
  for (const [uuid, at] of keep) next[uuid] = at
  return next
}
// byClaude-end
