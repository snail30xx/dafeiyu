/**
 * 大肥鱼管家面板 v10：按交互稿 dafayu-prototype.html 1:1 还原。
 * 结构与类名全部对齐设计稿：极光三团 + 视图切换（工作台/控制台）+
 * 工作台（greet-row / v1-work：work-chat[work-stage 3D 立绘舞台 + msgs 消息流] +
 * work-tasks[flow-scroll 任务卡 + done-sum] / quick 快捷指令 / ask-box 自绘输入条 /
 * statusbar）+ 控制台（hero 思考横幅 + cs-body：chat-panel + flow-panel 大步骤时间线）。
 * CSS 与 SVG symbol 由 boardCss.ts / boardDefs.ts 从设计稿全量迁移（scoped 到 .dfy-root）。
 * 数据全部真实：消息流 = 管家会话事件摘要；任务卡 = 会话目录看板；输入条直排会话队列。
 * byClaude-start 消息流不截断：长回复全文 Markdown 渲染；历史分页 = 默认最近 30 条，
 * 顶部提示「更多消息请往上查看」，滚到顶翻页（窗口内 +30 条，窗口尽则 loadOlder 拉更早）。（byClaude）
 * 官方 composer 完整对话保留为 detail 浮层（「完整对话」按钮进入，Esc 收起）。
 * byClaude
 */
// byClaude-start
// byClaude-start
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
// byClaude-end
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { ButlerFish, ButlerAvatar } from './ButlerFish.js'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SessionListState, SessionReference, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BUTLER_TITLE, isButlerHomePath, isImHomePath, TEAM_AGENTS, TEAM_DEFAULT_AGENT, TEAM_SESSION_PREFIX, type AutonomyStatus, type AutonomyToggleResult, type ProposalDecision, type ProposalReport, type ProposalsSnapshot, type TaskReport } from './constants.js'
import { TEAM_PERSONAS_ALL } from './teamPersonas.js'
import { rawWorkspaceSnapshot } from './homeFilter.js'
import type { TeamAgentDef } from './constants.js'
import { BOARD_CSS } from './boardCss.js'
import { SVG_DEFS } from './boardDefs.js'
import type { DafeiyuKey } from './locales.js'

/** 管家会话 face / 事件流的快照值类型（从 SessionReference 结构推导）。 */
type SessionFaceState = SessionReference['binding']['session'] extends ObservableSnapshot<infer S> ? S : never
type SessionEventsState = SessionReference['binding']['eventSource'] extends ObservableSnapshot<infer W> ? W : never

// byClaude-start IM（钉钉机器人）遥控面：结构对齐 dsh-im 契约 ImBotView 的最小字段（byClaude）
/** dsh-im 机器人快照里勾选框关心的字段（监听状态四态）。 */
export interface ImBotLike {
  readonly id: number
  readonly name: string
  readonly enabled: boolean
  readonly listenerStatus: 'stopped' | 'starting' | 'running' | 'error'
  readonly lastError?: string | undefined
  readonly revision: number
}

/** 面板对 dsh-im '/im' RPC 的最小遥控面：读快照 bots / 开关机器人。 */
export interface ButlerImControl {
  /** 读快照里的 bots；通道或服务不可用返回 null。 */
  readonly bots: () => Promise<readonly ImBotLike[] | null>
  /** 开关机器人（带乐观锁 revision）；成功返回新 bots，失败返回 null。 */
  readonly toggle: (botId: number, expectedRevision: number, enabled: boolean) => Promise<readonly ImBotLike[] | null>
}
// byClaude-end

/** 注入面板的动作面与数据源。 */
export interface ButlerInjected {
  readonly hooks: {
    /** 会话目录快照：三态看板的数据源（框架转成 useSessionList 钩子）。 */
    readonly sessionList: ObservableSnapshot<SessionListState>
    /** 工作区列表快照：取全局归档集与管家之家路径，看板不展示已归档/管家会话。 */
    readonly workspaceList: ObservableSnapshot<WorkspaceSnapshot>
  }
  // byClaude-start 原始工作区快照源（未过 homeFilter 投影）：面板检测 IM 标记工作区用（byClaude）
  readonly workspaceRaw: ObservableSnapshot<WorkspaceSnapshot>
  // byClaude-end
  // byClaude-start IM（钉钉机器人）遥控面（dsh-im 的 '/im' RPC 经 connection 服务）；null = 通道不可用（byClaude）
  readonly imControl: ButlerImControl | null
  // byClaude-end
  // byClaude-start 派活台账数据面：host 的 /api/dafeiyu/tasks 轮询（完成检测见
  // host 侧 tasks.ts）；null = 通道不可用，面板隐藏「已完成·自动汇报」能力（byClaude）
  readonly tasks: () => Promise<readonly TaskReport[] | null>
  // byClaude-end
  // byClaude-start 管家提议数据面：host 的 /api/dafeiyu/proposals 轮询（巡检见
  // host 侧 autonomy.ts），同一响应带自主循环心跳；null = 通道不可用，面板隐藏
  // 「管家提议」组与心跳行（byClaude）
  readonly proposals: () => Promise<ProposalsSnapshot | null>
  /** 主人裁决提议：ok:false 带端点真实原因（每日上限/派活失败等，toast 透传）；null = 网络层失败。 */
  readonly decideProposal: (id: string, action: 'approve' | 'ignore') => Promise<ProposalDecision | null>
  /** 自主性总开关（A 卡 toggle）：改 ones.enabled 立即生效；null = 网络层失败。 */
  readonly toggleAutonomy: (enabled: boolean) => Promise<AutonomyToggleResult | null>
  // byClaude-end
  /** 取得管家会话引用：找不到就新建并改名，返回已 retain 的引用（面板负责 release）。 */
  readonly acquire: () => Promise<SessionReference>
  // byClaude-start agent team 聊天室：成员会话引用工厂（独立工作区 = 独立上下文）（byClaude）
  readonly acquireTeam: (agentId: string) => Promise<SessionReference>
  // byClaude-end
  // byClaude-start 系统技能目录（官方 skills/list Remote）；null = 不可用，编辑器退回手填（byClaude）
  readonly listSkills: (sessionId: SessionId) => Promise<readonly { name: string; description?: string }[] | null>
  // byClaude-end
  /** 跳转到指定对话（切到官方会话视图）。 */
  readonly openSession: (sessionId: SessionId) => void
  /** 模型目录与选择面；null = 宿主运行时不支持，面板退化为无选择器。 */
  readonly models: {
    /** 拉取模型目录（provider 分组 + 各模型的思考深度档位）；失败返回 null。 */
    readonly catalog: () => Promise<ModelCatalogLike | null>
    /** 给会话选模型/思考深度（session 级生效）；失败返回 false。 */
    readonly select: (sessionId: SessionId, selection: ModelSelectionLike) => Promise<boolean>
  } | null
}

// byClaude-start 模型选择数据面：结构对齐 dsh-api-session-controller 的 ModelCatalog/ModelSelection（byClaude）
/** 一次模型选择：provider（如 deepseek）+ 模型 id + 可选思考深度档位。 */
export interface ModelSelectionLike {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** 模型目录：默认选择 + provider 分组的模型列表。 */
export interface ModelCatalogLike {
  readonly default: ModelSelectionLike
  readonly groups: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly models: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly description?: string | undefined
      readonly reasoning?: {
        readonly efforts: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description?: string | undefined }>
        readonly defaultEffort?: string | undefined
      } | undefined
    }>
  }>
}
// byClaude-end

// byClaude-start ONES 巡检项目的显示名：autonomy 配置用别名/uuid（vas 无短别名，
// 只能用 uuid），面板翻译成人话；未知项目回退截断显示（byClaude）
const ONES_PROJECT_LABELS: Record<string, string> = { vos: 'VOS', vbs: 'VBS', '7mRHdFBMDzZs8r6s': 'VAS' }

/** ONES 项目名 → 面板短名（未知项目截断保底）。 */
function onesProjectLabel(project: string): string {
  return ONES_PROJECT_LABELS[project] ?? (project.length > 10 ? `${project.slice(0, 6)}…` : project)
}
// byClaude-end

/** 主面板 props：main 运行时 + 子槽渲染面（含 SessionProvider）+ 注入面 + 文案。 */
export type ButlerPanelProps = PropsRuntime<'main'>
  & PropsRenderSlots<'dafeiyu.butler.chat'>
  & InjectFace<ButlerInjected>
  & PropsLocale<'dafeiyu'>

/** 手动「已完成」覆盖的本地持久键：{ [sessionId]: true }。 */
const DONE_STORAGE_KEY = 'dafeiyu.board.done'
/** 「已忽略」会话的本地持久键：从看板整个隐藏（与完成不同，忽略 = 不关心）。 */
const IGNORE_STORAGE_KEY = 'dafeiyu.board.ignore'
/** 待确认窗口：最近活动过且没在跑的对话视为等用户确认。 */
const PENDING_WINDOW_MS = 48 * 60 * 60 * 1000
const DONE_LIST_CAP = 50
// byClaude-start 执行流列表每页条数：默认最近 20 个，超出翻页（byClaude）
const FLOW_PAGE_SIZE = 20
// byClaude-end
// byClaude-start 对话历史分页：默认渲染最近 30 条，滚到顶自动翻页
// （窗口内再放 30 条；窗口耗尽拉 session.loadOlder 的更早历史页）（byClaude）
/** 消息流默认渲染条数（最近的 N 条）。 */
const DIGEST_VISIBLE_INIT = 30
/** 每次上拉翻页放出的条数（窗口内翻页与 loadOlder 后共用）。 */
const DIGEST_PAGE = 30
// byClaude-end

/** 模块级稳定选择器：让 useSyncExternalStore 的 getSnapshot 引用稳定。 */
const selectRunning = (state: SessionFaceState | undefined): boolean => state?.running ?? false

/** 迷你聊天总结的一行：seq（稳定 key）+ 谁说的 + 摘要文本 + 事件时间。 */
export interface ChatDigestRow {
  readonly seq: number
  readonly role: 'user' | 'butler'
  readonly text: string
  readonly time: number
  /** 流式进行中的管家行（跟随 assistant/live-chunk 增量）。 */
  readonly streaming?: boolean
}

/** 聊天室输入条的空模型选择回调（该输入条不显示模型选择器）。 */
const noopModelSelect = (): void => {}

/** 空总结的模块级常量：useSyncExternalStore 的 getSnapshot 必须返回稳定引用。 */
const EMPTY_DIGEST: readonly ChatDigestRow[] = []
/** revision → 摘要行缓存：同一快照 revision 期间复用同一数组引用，防无限重渲染。 */
const digestCache = new WeakMap<object, { revision: number; rows: readonly ChatDigestRow[] }>()

// byClaude-start 摘要不再截断：长回复全文进气泡（消息流本身可滚动，完整信息不丢；
// 控制台 hero 思考横幅的紧凑显示交给 CSS 行数钳制 + title 悬浮全文）（byClaude）

/** 从事件窗收全部真人消息与流式管家输出（新消息在后；渲染条数由面板分页控制）。 */
const selectRecentTurns = (window: SessionEventsState | undefined): readonly ChatDigestRow[] => {
  if (window === undefined) return EMPTY_DIGEST
  const view = window as { readonly entries?: readonly unknown[]; readonly revision?: number }
  const revision = view.revision ?? -1
  const cached = digestCache.get(window as object)
  if (cached !== undefined && cached.revision === revision) return cached.rows
  const entries = view.entries ?? []
  const rows: ChatDigestRow[] = []
  let index = entries.length - 1

  // 尾部 transient 段 = 正在流式的管家输出：倒序吃 text-delta 再正着拼回。
  // settle 后这段被 durable assistant/message 行替换，自然过渡成普通摘要行。
  let liveText = ''
  let liveSeq = 0
  let liveTime = 0
  for (; index >= 0; index--) {
    const entry = entries[index] as {
      readonly type?: unknown
      readonly event?: { readonly type?: unknown; readonly seq?: number; readonly time?: number
        readonly data?: { readonly chunk?: { readonly type?: unknown; readonly text?: unknown } } }
    }
    if (entry?.type !== 'transient') break
    const live = entry.event
    if (live?.type === 'assistant/live-chunk' && live.data?.chunk?.type === 'text-delta'
      && typeof live.data.chunk.text === 'string') {
      liveText = live.data.chunk.text + liveText
      liveSeq = Math.max(liveSeq, live.seq ?? 0)
      liveTime = Math.max(liveTime, live.time ?? 0)
    }
  }
  if (liveText !== '') {
    rows.push({ seq: liveSeq, role: 'butler', text: liveText, time: liveTime, streaming: true })
  }

  // durable 消息：user 只认真人输入（source.kind === 'user'）——运行时上下文、
  // system-reminder 等工具注入也走 user/message 事件，混进摘要就全是噪音。
  for (; index >= 0; index--) {
    // 经 event-type 判别后 event 必在：cast 里声明为必有省去二次判空。
    const entry = entries[index] as {
      readonly type?: unknown
      readonly event: { readonly type?: unknown; readonly seq?: number; readonly time?: number; readonly data?: unknown }
    }
    if (entry?.type !== 'event') continue
    const eventType = entry.event?.type
    if (eventType !== 'assistant/message' && eventType !== 'user/message') continue
    // assistant/message 的 data 带 {message}；user/message 的 data 即 message 本体。
    const data = entry.event.data as {
      readonly message?: { readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[] }
      readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
      readonly source?: { readonly kind?: unknown }
    } | undefined
    if (eventType === 'user/message' && data?.source?.kind !== 'user') continue
    const content = eventType === 'user/message' ? data?.content : data?.message?.content
    const text = (content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string).join('').trim()
    if (text === '') continue
    rows.push({
      seq: entry.event.seq ?? index,
      role: eventType === 'user/message' ? 'user' : 'butler',
      text,
      time: entry.event.time ?? 0,
    })
  }
  const rowsView: readonly ChatDigestRow[] = rows.reverse()
  digestCache.set(window as object, { revision, rows: rowsView })
  return rowsView
}

// byClaude-start 事件窗「还有更早历史」标记：loadOlder 翻页的数据面（byClaude）
/** 模块级稳定选择器：事件窗口是否还有更早历史可拉。 */
const selectEventsHasMore = (window: SessionEventsState | undefined): boolean =>
  (window as { readonly hasMore?: boolean } | undefined)?.hasMore === true
// byClaude-end

// byClaude-start 控制台思考过程滚动条：跑动中管家「此刻在干嘛」的实时尾部——
// reasoning-delta（思考）/ text-delta（正文）/ 工具调用名，随流式增量刷新；
// 没有流式尾巴（工具在执行）时报最近一个 durable tool/call（byClaude）
/** 滚动条状态：kind = 最近一次流式活动的类型；text = 折行取尾的展示文本。 */
interface LiveTickerState {
  readonly kind: 'reasoning' | 'text' | 'tool'
  readonly text: string
  readonly truncated: boolean
}

/** 展示尾部的字符预算（状态栏单行，只看最新一段）。 */
const TICKER_TAIL = 120
/** 倒序收集的提前停机阈值：最近一条流的尾部够拼展示即可，长回复不整段倒序扫。 */
const TICKER_COLLECT = 600
/** 无流式尾巴时向后找最近 tool/call 的扫描预算。 */
const TICKER_DURABLE_SCAN = 300

const tickerCache = new WeakMap<object, { revision: number; value: LiveTickerState | undefined }>()

/** 折行取尾：空白压成单空格，保留最后 TICKER_TAIL 字符（截过则标记加「…」前缀）。 */
function tickerTail(text: string): { readonly text: string; readonly truncated: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= TICKER_TAIL) return { text: flat, truncated: false }
  return { text: flat.slice(-TICKER_TAIL), truncated: true }
}

const selectLiveTicker = (window: SessionEventsState | undefined): LiveTickerState | undefined => {
  if (window === undefined) return undefined
  const view = window as { readonly entries?: readonly unknown[]; readonly revision?: number }
  const revision = view.revision ?? -1
  const cached = tickerCache.get(window as object)
  if (cached !== undefined && cached.revision === revision) return cached.value
  const entries = view.entries ?? []
  // 尾部 transient 段（正在流式的那次尝试）：倒序吃 delta、正着拼回；
  // 最先遇到的那种 delta = 最新活动，决定滚动条展示哪条流。
  let reasoning = ''
  let text = ''
  let toolName: string | undefined
  let lastKind: LiveTickerState['kind'] | undefined
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as {
      readonly type?: unknown
      readonly event?: { readonly type?: unknown; readonly data?: { readonly chunk?: { readonly type?: unknown; readonly text?: unknown; readonly name?: unknown } } }
    }
    if (entry?.type !== 'transient') break
    if (entry.event?.type !== 'assistant/live-chunk') continue
    const chunk = entry.event.data?.chunk
    if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
      if (lastKind === undefined) lastKind = 'reasoning'
      reasoning = chunk.text + reasoning
    } else if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      if (lastKind === undefined) lastKind = 'text'
      text = chunk.text + text
    } else if (chunk?.type === 'tool-call-delta') {
      if (lastKind === undefined) lastKind = 'tool'
      if (toolName === undefined && typeof chunk.name === 'string') toolName = chunk.name
    } else continue
    if (lastKind === 'reasoning' && reasoning.length >= TICKER_COLLECT) break
    if (lastKind === 'text' && text.length >= TICKER_COLLECT) break
    if (lastKind === 'tool' && toolName !== undefined) break
  }
  let value: LiveTickerState | undefined
  if (lastKind === 'reasoning') value = { kind: 'reasoning', ...tickerTail(reasoning) }
  else if (lastKind === 'text') value = { kind: 'text', ...tickerTail(text) }
  else if (lastKind === 'tool') value = { kind: 'tool', text: toolName ?? '', truncated: false }
  else {
    // 没有流式尾巴：多半是工具在执行——报最近一个 durable tool/call 的工具名。
    for (let index = entries.length - 1; index >= 0 && index >= entries.length - TICKER_DURABLE_SCAN; index--) {
      const entry = entries[index] as {
        readonly type?: unknown
        readonly event?: { readonly type?: unknown; readonly data?: { readonly name?: unknown } }
      }
      if (entry?.type !== 'event' || entry.event?.type !== 'tool/call') continue
      const name = entry.event.data?.name
      value = { kind: 'tool', text: typeof name === 'string' ? name : '', truncated: false }
      break
    }
  }
  tickerCache.set(window as object, { revision, value })
  return value
}
// byClaude-end

/**
 * 订阅一个可能尚未就绪的快照源；source 为 undefined 时返回 select(undefined)。
 * @param source - 快照源（可为 undefined）。
 * @param select - 模块级稳定选择器。
 * @returns 选择结果。
 */
function useSnapshot<T, S>(source: ObservableSnapshot<T> | undefined, select: (value: T | undefined) => S): S {
  const subscribe = useCallback(
    (onChange: () => void) => source?.subscribe(onChange) ?? (() => {}),
    [source],
  )
  const getSnapshot = useCallback(() => select(source?.getSnapshot()), [source, select])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** 相对时间（跟随面板语言）。 */
function timeAgo(updatedAt: number, t: (key: DafeiyuKey) => string): string {
  if (updatedAt <= 0) return ''
  const minutes = Math.floor((Date.now() - updatedAt) / 60000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes').replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hours').replace('{n}', String(hours))
  return t('time.days').replace('{n}', String(Math.floor(hours / 24)))
}

// byClaude-start agent team 聊天室：群消息类型、@ 解析、共享上下文拼接与回复采集（byClaude）
/** 聊天室一行消息：from = 'me'（主人）或成员 id；pending = 该成员正在想。 */
export interface TeamMessage {
  readonly id: number
  readonly from: string
  readonly text: string
  readonly time: number
  readonly pending?: boolean
  readonly error?: boolean
}

/** 聊天室历史持久化键与容量上限（localStorage；pending/error 态不落盘）。 */
const TEAM_LOG_KEY = 'dafeiyu.team.log'
const TEAM_LOG_CAP = 300

function readTeamLog(): readonly TeamMessage[] {
  try {
    const raw = window.localStorage.getItem(TEAM_LOG_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is TeamMessage => {
      if (row === null || typeof row !== 'object') return false
      const m = row as Partial<TeamMessage>
      return typeof m.id === 'number' && typeof m.from === 'string' && typeof m.text === 'string'
    }).slice(-TEAM_LOG_CAP)
  } catch {
    return []
  }
}

function persistTeamLog(rows: readonly TeamMessage[]): void {
  try {
    const durable = rows.filter(row => row.pending !== true && row.error !== true).slice(-TEAM_LOG_CAP)
    window.localStorage.setItem(TEAM_LOG_KEY, JSON.stringify(durable))
  } catch { /* 存储满/隐私模式可忽略 */ }
}

// byClaude-start 成员人格/技能的本地覆盖：localStorage 持久，派发时注入 prompt（byClaude）
/** 一名成员的主人编辑版配置：留空字段 = 用内置人格文件。 */
export interface TeamOverride {
  readonly persona: string
  readonly skills: string
}

const TEAM_OVERRIDE_KEY = 'dafeiyu.team.overrides'

function readTeamOverrides(): Record<string, TeamOverride> {
  try {
    const raw = window.localStorage.getItem(TEAM_OVERRIDE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    const out: Record<string, TeamOverride> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object') continue
      const v = value as Partial<TeamOverride>
      if (typeof v.persona === 'string' && typeof v.skills === 'string') out[id] = { persona: v.persona, skills: v.skills }
    }
    return out
  } catch {
    return {}
  }
}

function persistTeamOverrides(rows: Record<string, TeamOverride>): void {
  try { window.localStorage.setItem(TEAM_OVERRIDE_KEY, JSON.stringify(rows)) } catch { /* 可忽略 */ }
}
// byClaude-end

/** 成员 id → 定义（未知 id 容错为肥鱼色占位）。 */
function teamAgentOf(id: string): TeamAgentDef | undefined {
  return TEAM_AGENTS.find(agent => agent.id === id)
}

/**
 * 解析消息里的 @提及：支持「@肥鱼 / @码仔 / @探长 / @笔杆」成员名全匹配。
 * 谁都没 @ 到就发给默认成员（肥鱼）。
 */
function parseTeamMentions(text: string): string[] {
  const hits: string[] = []
  for (const agent of TEAM_AGENTS) {
    if (text.includes(`@${agent.name}`) && !hits.includes(agent.id)) hits.push(agent.id)
  }
  return hits.length === 0 ? [TEAM_DEFAULT_AGENT] : hits
}

/**
 * 共享上下文：把聊天室最近若干条消息拼成文字记录发给成员会话——
 * 成员上下文各自独立（各自的 AGENTS.md 与历史），群聊窗口内容靠这份拼接共享。
 */
function teamContextTranscript(rows: readonly TeamMessage[], windowSize: number): string {
  const slice = rows.filter(row => row.pending !== true && row.error !== true).slice(-windowSize)
  if (slice.length === 0) return ''
  return slice.map(row => {
    const who = row.from === 'me' ? '主人' : (teamAgentOf(row.from)?.name ?? row.from)
    return `[${who}] ${row.text}`
  }).join('\n')
}

/** events 快照里是否还有流式输出（尾部 transient 存在 assistant/live-chunk）。 */
function teamStreamingActive(snapshot: unknown): boolean {
  const view = snapshot as { readonly entries?: readonly unknown[] } | undefined
  const entries = view?.entries ?? []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { readonly type?: unknown } | undefined
    if (entry?.type !== 'transient') break
    return true
  }
  return false
}

/**
 * 取 since 之后最后一条完整 assistant 回复全文（聊天室不做 480 字截断，气泡可滚动）。
 * 与 selectRecentTurns 同构，但保留完整文本且按时间过滤。
 */
function lastAssistantReplySince(snapshot: unknown, since: number): string | undefined {
  const view = snapshot as { readonly entries?: readonly unknown[] } | undefined
  const entries = view?.entries ?? []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as {
      readonly type?: unknown
      readonly event?: { readonly type?: unknown; readonly time?: number
        readonly data?: { readonly message?: { readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[] } } }
    } | undefined
    if (entry?.type !== 'event') continue
    if (entry.event?.type !== 'assistant/message') continue
    if ((entry.event.time ?? 0) <= since) continue
    const text = (entry.event.data?.message?.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string).join('').trim()
    if (text !== '') return text
  }
  return undefined
}
// byClaude-end

/** 按本地小时推问候语 key（5-11 早、11-18 午、其余晚）。 */
function greetingKey(date: Date): DafeiyuKey {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'greet.morning'
  if (hour >= 11 && hour < 18) return 'greet.afternoon'
  return 'greet.evening'
}

/** 快捷吩咐：symbol 图标名 + 展示文案 key + 实际发送文本 key（对齐设计稿 quick）。 */
const CHIPS: ReadonlyArray<{ readonly icon: string; readonly label: DafeiyuKey; readonly text: DafeiyuKey }> = [
  { icon: 'zap', label: 'chip.report', text: 'chip.report.text' },
  { icon: 'activity', label: 'chip.whatRunning', text: 'chip.whatRunning.text' },
  { icon: 'file-text', label: 'chip.summarize', text: 'chip.summarize.text' },
  { icon: 'plus', label: 'chip.newChat', text: 'chip.newChat.text' },
]

/** 待机时头顶随机冒出的短语（locales say.*）。 */
const SAY_KEYS = ['say.1', 'say.2', 'say.3', 'say.4', 'say.5'] as const satisfies readonly DafeiyuKey[]

// byClaude-start 模型选择的本地记忆（键结构 = ModelSelectionLike）（byClaude）
const MODEL_STORAGE_KEY = 'dafeiyu.model'
function readStoredModel(): ModelSelectionLike | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MODEL_STORAGE_KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.provider !== 'string' || typeof record.model !== 'string') return null
    const effort = record.reasoningEffort
    return { provider: record.provider, model: record.model, reasoningEffort: typeof effort === 'string' ? effort : undefined }
  } catch {
    return null
  }
}
// byClaude-end

/** 读取本地「已完成」覆盖表；坏数据按空表处理。 */
function readDoneMap(): Record<string, true> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DONE_STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, true> : {}
  } catch {
    return {}
  }
}

/** 读取本地「已忽略」表（用户明示不关心的会话，从看板整个隐藏）；坏数据按空表处理。 */
function readIgnoreMap(): Record<string, true> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(IGNORE_STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, true> : {}
  } catch {
    return {}
  }
}

/** 会话的项目目录名（任务卡明细行数据源：cwd 取 basename）。 */
function cwdName(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** 设计稿内联图标：引用迁移后的 SVG symbol（id 带 d- 前缀）。 */
function Icon({ n, className }: { n: string; className?: string }) {
  return <svg className={className ?? 'ic'} aria-hidden="true"><use href={`#d-${n}`} /></svg>
}

/** 声波柱（设计稿 .wave）：她说着话的招牌元素，12 根交错伸缩，仅流式行显示。 */
function Wave() {
  return <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
}

/**
 * 消息流（设计稿 .msgs）：user 右「我」/ ai 左精灵头像；
 * 流式行带 stream 渐变 + 声波柱 + 计时胶囊。
 * byClaude-start 历史分页与滚动维护：默认渲染最近 N 条（面板切片传入），顶部提示
 * 「更多消息请往上查看」；滚到顶（或点提示）触发翻页。滚动规则：
 * - 粘底：仅当用户停在底部（< 80px）才跟随新消息/流式增量滚到底；
 * - 顶部锚定：翻页拉出的旧消息插在上方，恢复「距底距离」让视口停在原内容上，
 *   用户继续上滚才再翻下一页（继续滚动 = 继续分页）。
 * overflow-anchor 关掉（boardCss），浏览器原生锚定与本恢复逻辑二选一，JS 版跨引擎可判。（byClaude）
 */
function MsgList({ rows, running, thinking, t, digestRef, userAvatar, paging }: {
  rows: readonly ChatDigestRow[]
  running: boolean
  /** 无流式行但会话在跑：追加「正在想…」占位行。 */
  thinking: string
  t: (key: DafeiyuKey) => string
  digestRef: { readonly current: HTMLDivElement | null }
  /** 登录用户头像 URL；null 时用户消息头像退回「我」字。 */
  userAvatar: string | null
  /** 上拉分页面：more = 还有更早消息；onReachTop = 滚到顶部/点提示时翻页。 */
  paging?: { readonly more: boolean; readonly loading: boolean; readonly onReachTop: () => void } | undefined
}) {
  /** 用户是否停在底部（粘底跟随的开关；挂载初始 true = 首屏落底）。 */
  const atBottomRef = useRef(true)
  /** 触发翻页那一刻的「距底距离」：旧消息插入后按它恢复视口。 */
  const anchorRef = useRef<number | null>(null)
  /** 上一轮首行 seq：变化 = 顶部插入了更早的消息。 */
  const prevFirstSeqRef = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const node = digestRef.current
    if (node === null) return
    const firstSeq = rows[0]?.seq
    const prepended = prevFirstSeqRef.current !== undefined && firstSeq !== prevFirstSeqRef.current
    if (prepended && anchorRef.current !== null) {
      // 顶部锚定：视口回到原内容（翻页不跳屏）。
      node.scrollTop = node.scrollHeight - anchorRef.current
      anchorRef.current = null
    } else if (anchorRef.current !== null) {
      // 翻页在途（loadOlder 异步）：流式尾部增量后刷新基线，保持锚有效。
      anchorRef.current = node.scrollHeight - node.scrollTop
    } else if (atBottomRef.current) {
      node.scrollTop = node.scrollHeight
    }
    prevFirstSeqRef.current = firstSeq
  }, [rows, digestRef])
  // byClaude-start 侧边栏收起/展开等容器变宽变窄时，消息重新折行、scrollHeight 跟着
  // 变，但 rows 没变——上面的粘底 effect 不跑，列表停在旧 scrollTop 上（最新消息沉到
  // 视口外）。三路信号兜底重钉：容器尺寸变化（ResizeObserver）、窗口缩放（resize）、
  // 任意点击后的两拍延时（侧边栏收起/展开没有原生事件，但必经一次点击；实测部分
  // 嵌入壳不派发 RO/resize，点击链路始终可用）。用户不在底部（atBottomRef=false）时
  // 一律不动，不打断上翻阅读（byClaude）
  useEffect(() => {
    const node = digestRef.current
    if (node === null) return
    const repin = (): void => {
      if (atBottomRef.current) node.scrollTop = node.scrollHeight
    }
    const observer = new ResizeObserver(repin)
    observer.observe(node)
    const onDocClick = (): void => {
      window.setTimeout(repin, 50)
      window.setTimeout(repin, 250)
    }
    document.addEventListener('click', onDocClick, true)
    window.addEventListener('resize', repin)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', onDocClick, true)
      window.removeEventListener('resize', repin)
    }
  }, [digestRef])
  // byClaude-end
  const onScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const node = event.currentTarget
    atBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    if (paging === undefined || node.scrollTop > 48 || node.scrollHeight - node.clientHeight <= 8) return
    anchorRef.current = node.scrollHeight - node.scrollTop
    paging.onReachTop()
  }
  return (
    <div className="msgs" ref={digestRef} role="log" aria-live="polite" aria-label={t('panel.chat')} onScroll={onScroll}>
      {paging !== undefined && paging.more && rows.length > 0 && (
        <button type="button" className="dfy-more-hint" onClick={paging.onReachTop}>
          {paging.loading ? t('chat.more.loading') : t('chat.more.up')}
        </button>
      )}
      {rows.length === 0
        ? <div className="msg ai" key="empty"><div className="ava" aria-hidden="true"><ButlerAvatar /></div><div className="bubble">{t('chat.empty')}</div></div>
        : rows.map(row => (
          // byClaude-start 流式行用固定 key：live-chunk 的 seq 每个 delta 递增，拿它当 key 会让气泡
          // 每个 token 重建一次、dfy-rise 入场动画无限重放（思考结束正文流出时表现为持续闪动）（byClaude）
          <div key={row.streaming === true ? 'live' : row.seq} className={`msg ${row.role === 'user' ? 'user' : 'ai'}`}>
          {/* byClaude-end */}
            <div className="ava" aria-hidden="true">
              {row.role === 'user'
                ? (userAvatar !== null
                    ? <img className="dfy-user-avatar" src={userAvatar} alt="" referrerPolicy="no-referrer" />
                    : '我')
                : <ButlerAvatar />}
            </div>
            {/* byClaude-start 气泡正文走完整 Markdown 渲染（粗体/列表/代码块/表格）；流式态由 caret 光标 + 声波表达（byClaude） */}
            <div className={`bubble md${row.streaming === true ? ' streaming' : ''}`}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{row.text}</Markdown>
              {row.streaming === true && <span className="caret" aria-hidden="true" />}
            </div>
            {/* byClaude-end */}
            {row.role === 'butler' && row.streaming === true && (
              <div className="meta"><Wave /></div>
            )}
          </div>
        ))}
      {running && rows.every(row => row.streaming !== true) && (
        <div className="msg ai" key="thinking">
          <div className="ava" aria-hidden="true"><ButlerAvatar /></div>
          <div className="bubble"><span className="stream">{thinking}</span></div>
        </div>
      )}
    </div>
  )
}

// byClaude-start 人机交互拦截条：宿主 approval（工具审批）/ question（选择题）待交互，
// 官方 UI 只渲染在 Conversation 视图，面板占用 main 槽时主人看不到；这里把待交互
// 投影进面板输入条上方，approval 直接作答、question 跳官方对话（byClaude）
/** 宿主 approval 待交互的结构探测面（dsh-client-ui-approval 的 PendingApproval）。 */
interface ApprovalInteractionLike {
  readonly kind: 'approval'
  readonly key: string
  readonly toolName?: string
  readonly reason?: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string } | undefined
  answerable?: boolean
  answer?: (outcome: 'allowed-once' | 'rejected') => Promise<void>
}

/** question / plan-review 及未知 kind 的兜底面：面板内不答题，跳官方对话处理。 */
interface OtherInteractionLike {
  readonly kind: string
  readonly key: string
  readonly questions?: readonly { readonly question?: string }[] | undefined
}

/** 面板待交互卡：kind 判定后的渲染数据。 */
export interface InterceptCard {
  readonly sessionId: SessionId
  readonly key: string
  readonly kind: string
  readonly approval: ApprovalInteractionLike | undefined
  readonly firstQuestion: string | undefined
  readonly isButler: boolean
  readonly title: string | undefined
}

/**
 * 人机交互拦截条（设计语义：肥鱼把宿主的「弹选项」叼到主人面前）。
 * approval：允许一次 / 拒绝；其余 kind：跳官方对话。
 */
function InterceptBar({ cards, allowLabel, rejectLabel, goLabel, approveTitle, questionTitle, butlerLabel, onAllow, onReject, onOpen }: {
  cards: readonly InterceptCard[]
  allowLabel: string
  rejectLabel: string
  goLabel: string
  approveTitle: string
  questionTitle: string
  butlerLabel: string
  onAllow: (card: InterceptCard) => void
  onReject: (card: InterceptCard) => void
  onOpen: (sessionId: SessionId) => void
}) {
  if (cards.length === 0) return null
  return (
    <div className="dfy-intercepts" role="alert">
      {cards.slice(0, 3).map(card => {
        const approval = card.approval
        const subject = card.isButler ? butlerLabel : (card.title ?? card.sessionId)
        return (
          <div key={card.key} className="dfy-intercept">
            <div className="ix-ic" aria-hidden="true"><Icon n={approval !== undefined ? 'shield-check' : 'message-circle'} className="ic" /></div>
            <div className="ix-body">
              <div className="ix-title">{approval !== undefined ? approveTitle : questionTitle}</div>
              <div className="ix-sub" title={approval !== undefined ? (approval.reason ?? approval.toolName ?? '') : (card.firstQuestion ?? '')}>
                {approval !== undefined
                  ? `${approval.toolName ?? 'tool'} · ${card.isButler ? subject : subject}`
                  : (card.firstQuestion ?? subject)}
              </div>
            </div>
            {approval !== undefined ? (
              <div className="ix-acts">
                <button type="button" className="ix-btn" disabled={approval.answerable === false} onClick={() => { onAllow(card) }}>
                  {allowLabel}
                </button>
                <button type="button" className="ix-btn deny" disabled={approval.answerable === false} onClick={() => { onReject(card) }}>
                  {rejectLabel}
                </button>
              </div>
            ) : (
              <div className="ix-acts">
                <button type="button" className="ix-btn" onClick={() => { onOpen(card.sessionId) }}>
                  {goLabel}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
// byClaude-end

/**
 * 任务卡（设计稿 .tcard）：点击跳会话；LIVE = 流光描边 + 步骤行 + indeterminate 进度条；
 * 待确认 = 批准（收尾）/ 拒绝（忽略）双动作；明细行显示项目目录名。
 */
function TaskCard({ row, stage, just, onOpen, onApprove, onReject, t }: {
  row: SessionSummary
  stage: 'ongoing' | 'pending'
  just: boolean
  onOpen: () => void
  onApprove: () => void
  onReject: () => void
  t: (key: DafeiyuKey) => string
}) {
  const live = stage === 'ongoing'
  const project = cwdName(row.cwd)
  return (
    <article
      className={`tcard${live ? ' live' : ''}${just ? ' just' : ''}`}
      role="button"
      tabIndex={0}
      title={t('board.openHint')}
      onClick={onOpen}
      onKeyDown={event => {
        // 卡片本体才代理 Enter/Space；焦点在内层按钮时让按钮自己处理，否则按键会误触跳会话。
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="t-top">
        <span className={`t-ico ${live ? 'cyan' : 'amber'}`} aria-hidden="true"><Icon n={live ? 'zap' : 'power'} className="ic sm" /></span>
        <div className="t-name">{row.displayTitle}{live && <span className="live-chip">LIVE</span>}</div>
        {live && <span className="t-time mono">{timeAgo(row.updatedAt, t)}</span>}
      </div>
      {project !== '' && <div className="t-desc">{project}</div>}
      {live && (
        <>
          <div className="t-steps">
            <span className="st done"><Icon n="check" className="ic xs" />{t('tstep.received')}</span>
            <span className="st cur"><span className="spinner" aria-hidden="true" />{t('tstep.thinking')}…</span>
          </div>
          {/* 真实进度不在面板侧：indeterminate 流动条示意「在推进」。 */}
          <div className="t-bar indet" role="progressbar" aria-label={row.displayTitle}><i /></div>
        </>
      )}
      {!live && (
        <div className="t-acts">
          <button
            type="button"
            className="mini ok"
            aria-label={`${t('board.approve')}: ${row.displayTitle}`}
            onClick={event => { event.stopPropagation(); onApprove() }}
          ><Icon n="check" className="ic xs" />{t('board.approve')}</button>
          <button
            type="button"
            className="mini no"
            aria-label={`${t('board.reject')}: ${row.displayTitle}`}
            onClick={event => { event.stopPropagation(); onReject() }}
          ><Icon n="x" className="ic xs" />{t('board.reject')}</button>
        </div>
      )}
    </article>
  )
}

/** 控制台大步骤（设计稿 .flow .step）：done / live / wait 三态时间线行。 */
function FlowStep({ row, stage, report, onOpen, onApprove, onReject, t }: {
  row: SessionSummary
  stage: 'ongoing' | 'pending' | 'done'
  /** 派活台账的完成汇报：有则正文行展示总结/注记（替代项目名）。 */
  report?: TaskReport | undefined
  onOpen: () => void
  onApprove: () => void
  onReject: () => void
  t: (key: DafeiyuKey) => string
}) {
  const live = stage === 'ongoing'
  const wait = stage === 'pending'
  const project = cwdName(row.cwd)
  const icon = live ? undefined : wait ? 'power' : 'check'
  // byClaude-start 台账汇报行：等交互 → 等待提示 + 去处理；完成 → 总结两行钳制（byClaude）
  const waiting = report?.status === 'waiting-input'
  const waitingKind = waiting ? t(`tasks.waiting.${report?.pendingKind ?? 'other'}`) : undefined
  const reportLine = waiting
    ? t('tasks.waiting.hint')
    : report !== undefined
      ? (report.summary ?? (report.note !== undefined ? t(`tasks.note.${report.note}`) : t('tasks.noSummary')))
      : undefined
  // byClaude-end
  return (
    <li
      className={`step ${live ? 'live' : wait ? 'wait' : 'done'}`}
      role="button"
      tabIndex={0}
      title={t('board.openHint')}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="s-ico" aria-hidden="true">
        {live ? <span className="spinner" /> : icon !== undefined ? <Icon n={icon} className="ic sm" /> : null}
      </span>
      <div className="s-body">
        <div className="s-h">
          <b>{row.displayTitle}</b>
          <span className="s-tag">{live ? t('board.running') : waitingKind !== undefined ? waitingKind : wait ? t('stage.pending') : t('stage.done')}</span>
        </div>
        {/* byClaude-start 正文行优先展示台账汇报（等交互提示/完成总结），没有则回退项目目录名（byClaude） */}
        <p className={`s-p${reportLine !== undefined ? ' s-sum' : ''}`} title={reportLine}>
          {reportLine ?? (project !== '' ? project : row.displayTitle)}
        </p>
        {/* byClaude-end */}
        {live && <div className="s-bar indet" role="progressbar" aria-label={row.displayTitle}><i /></div>}
        {wait && !waiting && (
          <div className="s-acts">
            <button type="button" className="mini ok" onClick={event => { event.stopPropagation(); onApprove() }}><Icon n="check" className="ic xs" />{t('board.approve')}</button>
            <button type="button" className="mini no" onClick={event => { event.stopPropagation(); onReject() }}><Icon n="x" className="ic xs" />{t('board.reject')}</button>
          </div>
        )}
        {waiting && (
          <div className="s-acts">
            <button type="button" className="mini ok" onClick={event => { event.stopPropagation(); onOpen() }}><Icon n="message-circle" className="ic xs" />{t('tasks.waitGo')}</button>
          </div>
        )}
      </div>
    </li>
  )
}

// byClaude-start 派活台账完成卡（自动汇报）：绿勾 + 标题 + 「已完成」章 + 总结两行钳制；
// 会话还在时可点击跳转，session-gone 且会话已消失时退化为纯展示（byClaude）
/** 台账完成卡：report = host 完成判定产物（总结或原因注记）。 */
function DoneCard({ report, title, just, onOpen, t }: {
  report: TaskReport
  title: string
  just: boolean
  onOpen: (() => void) | undefined
  t: (key: DafeiyuKey) => string
}) {
  const line = report.summary ?? (report.note !== undefined ? t(`tasks.note.${report.note}`) : t('tasks.noSummary'))
  return (
    <article
      className={`tcard ok${just ? ' just' : ''}`}
      role={onOpen !== undefined ? 'button' : undefined}
      tabIndex={onOpen !== undefined ? 0 : undefined}
      title={onOpen !== undefined ? t('board.openHint') : line}
      onClick={onOpen}
      onKeyDown={event => {
        if (onOpen === undefined || event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="t-top">
        <span className="t-ico green" aria-hidden="true"><Icon n="check" className="ic sm" /></span>
        <div className="t-name">{title}<span className="done-chip">{t('stage.done')}</span></div>
        <span className="t-time mono">{timeAgo(report.completedAt ?? report.dispatchedAt, t)}</span>
      </div>
      <div className="t-sum" title={line}>{line}</div>
    </article>
  )
}

// byClaude-start 台账等交互卡：主人只与管家对话的「汇报+下发」面——任务在等
// 批准/答题时落到这里，「去处理」跳官方对话作答（approval 也可在拦截条直答）；
// 主人无论在哪里答，pendingInput 一清、任务恢复，完成时另发完成汇报（byClaude）
/** 台账等交互卡：report = host 采样器发现的 waiting-input 汇报。 */
function WaitCard({ report, title, onOpen, t }: {
  report: TaskReport
  title: string
  onOpen: () => void
  t: (key: DafeiyuKey) => string
}) {
  const kind = report.pendingKind ?? 'other'
  return (
    <article
      className="tcard wait"
      role="button"
      tabIndex={0}
      title={t('board.openHint')}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="t-top">
        <span className="t-ico amber" aria-hidden="true"><Icon n="power" className="ic sm" /></span>
        <div className="t-name">{title}<span className="wait-chip">{t(`tasks.waiting.${kind}`)}</span></div>
        <span className="t-time mono">{timeAgo(report.dispatchedAt, t)}</span>
      </div>
      <div className="t-sum">{t('tasks.waiting.hint')}</div>
      <div className="t-acts">
        <button type="button" className="mini ok" onClick={event => { event.stopPropagation(); onOpen() }}>
          <Icon n="message-circle" className="ic xs" />{t('tasks.waitGo')}
        </button>
      </div>
    </article>
  )
}
// byClaude-end

// byClaude-start 自主意识模块（v3 A 卡·design/autonomy-scout-v3.html）：管家自己的
// ONES 需求巡检区，与执行流（会话列表）以渐变玻璃卡 + 分区线区隔。三态：正常
//（项目 chip + 下轮时间）/ 发现新需求（加重卡 + 内嵌条目行，数字做标题、标题行
// 做正文，就地批准/忽略，最多 3 条、多出折叠）/ 异常（琥珀化，头部点名失败项目，
// 有活照列）。心跳来自 autonomy-status.json（经 proposals 端点），条目来自提议台账
// pending；批准是外部写动作，永远只由主人的点击触发（byClaude）
/** 提议 ID（ones:<project>:<uuid>）→ 项目显示名。 */
function onesProjectOf(id: string): string {
  return onesProjectLabel(id.split(':')[1] ?? '')
}

/** 自主意识模块：status = 巡检心跳（老宿主可缺席）；pending = 待裁决提议（新→旧）。 */
function AutonomyMind({ status, pending, busy, onDecision, onToggle, toggleBusy, t }: {
  status: AutonomyStatus | undefined
  pending: readonly ProposalReport[]
  busy: string | undefined
  onDecision: (id: string, action: 'approve' | 'ignore') => void
  onToggle: (enabled: boolean) => void
  toggleBusy: boolean
  t: (key: DafeiyuKey) => string
}) {
  if (status === undefined && pending.length === 0) return null
  const clock = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const entries = status !== undefined ? Object.entries(status.projects) : []
  const failed = entries.filter(([, row]) => row.lastError !== undefined)
  const scoutAt = status?.lastScoutAt ?? status?.startedAt ?? Date.now()
  const overdue = status !== undefined && status.enabled
    && Date.now() - scoutAt > (status.intervalMinutes + 5) * 60_000
  const disabled = status !== undefined && !status.enabled
  const found = pending.length
  // 变体优先级：关停 = off（灰化降饱和）＞ 失败/超时 = err（琥珀）＞ 有活 = hot ＞ 正常。
  const variant = disabled ? 'off' : failed.length > 0 || overdue ? 'err' : found > 0 ? 'hot' : 'ok'
  const quiet = status?.inQuietHours === true ? ` · ${t('autonomy.quiet')}` : ''
  const pill = disabled ? t('autonomy.off')
    : failed.length > 0 ? `${failed.map(([project]) => onesProjectLabel(project)).join('、')} ✗ ${clock(scoutAt)}`
    : overdue ? t('autonomy.stale')
    : found > 0 ? `${clock(scoutAt)} ${t('autonomy.checked')}`
    : `${t('autonomy.ok')} ${clock(scoutAt)}`
  const shown = pending.slice(0, 3)
  const rest = found - shown.length
  const next = status?.nextScoutAt !== undefined && !disabled
    ? t('autonomy.next').replace('{time}', clock(status.nextScoutAt)) : ''
  const footNote = failed.length > 0
    ? `${failed.map(([project]) => onesProjectLabel(project)).join('、')}${t('autonomy.down')}${failed[0]?.[1]?.lastError !== undefined ? `（${failed[0][1].lastError.slice(0, 40)}）` : ''}`
    : ''
  const detail = entries.map(([project, row]) => row.lastError !== undefined
    ? `${onesProjectLabel(project)} ✗ ${row.lastError.slice(0, 60)}`
    : `${onesProjectLabel(project)} ✓`).join('\n')
  const minutes = status?.intervalMinutes ?? 30
  return (
    <section className={`mind ${variant}`} title={`${t('autonomy.tip')}${detail === '' ? '' : `\n${detail}`}`}>
      <div className="mind-top">
        <span className="mind-ava" aria-hidden="true">🐟</span>
        <span className="mind-id">
          <span className="mind-kind">{t('autonomy.kind')}</span>
          <span className="mind-title">{t('autonomy.name')}</span>
        </span>
        <span className={`mind-state ${variant}`}>{pill}{quiet}</span>
        {/* 自主性总开关：关巡检不关裁决（pending 仍可批准/忽略）。 */}
        <button type="button" className={`mind-sw${disabled ? '' : ' on'}`}
          aria-pressed={!disabled} disabled={toggleBusy || status === undefined}
          aria-label={t('autonomy.switch')}
          title={disabled ? t('autonomy.switch.on.hint').replace('{n}', String(minutes)) : t('autonomy.switch.off.hint')}
          onClick={() => { onToggle(disabled) }}>
          <span className="mind-sw-dot" aria-hidden="true" />
        </button>
      </div>
      {found > 0
        ? (
          <div className="found">
            <div className="found-head">
              <span className="n">{found}</span>
              {t('autonomy.found').replace('{n}', String(found))}
              {disabled ? '' : ` · ${t('autonomy.found.pending')}`}
            </div>
            {shown.map(report => (
              <div className="req" key={report.id}>
                <span className="pj">{onesProjectOf(report.id)}</span>
                <span className="tt" title={report.detail}>{report.title.replaceAll('_', ' ')}</span>
                <span className="btns">
                  <button type="button" className="b ok" disabled={busy === report.id}
                    onClick={() => { onDecision(report.id, 'approve') }}>{t('board.approve')}</button>
                  <button type="button" className="b no" disabled={busy === report.id}
                    onClick={() => { onDecision(report.id, 'ignore') }}>{t('proposals.ignore')}</button>
                </span>
              </div>
            ))}
            <div className="found-more">
              {[rest > 0 ? t('autonomy.found.more').replace('{n}', String(rest)) : '',
                footNote, next].filter(part => part !== '').join(' · ')}
            </div>
          </div>
          )
        : disabled
          ? (
            // 关停无活：一行大白话说明开关后果（裁决不随巡检关闭，有活时 found 区照常显示）。
            <div className="mind-mid">
              <span className="mind-off-hint">{t('autonomy.off.hint').replace('{n}', String(minutes))}</span>
            </div>
            )
          : (
            <div className="mind-mid">
              {entries.map(([project, row]) => (
                <span className={`m-chip${row.lastError !== undefined ? ' err' : ''}`} key={project}>
                  {onesProjectLabel(project)} {row.lastError !== undefined ? '✗' : '✓'}
                </span>
              ))}
              {next !== '' && <span className="mind-next">{next}</span>}
            </div>
            )}
    </section>
  )
}
// byClaude-end

// byClaude-start
/** 自绘输入条（设计稿 .ask-box）：Enter 直排管家会话队列；工具行 = 模型选择 + 思考深度 + 发送。 */
function AskBox({ disabled, placeholder, sendLabel, catalog, selection, onSelect, onSubmit, onFocusChange, insert }: {
  disabled: boolean
  placeholder: string
  sendLabel: string
  catalog: ModelCatalogLike | null
  selection: ModelSelectionLike | null
  onSelect: (next: ModelSelectionLike) => void
  onSubmit: (text: string) => void
  onFocusChange: (attentive: boolean) => void
  /** 外部插入信号（seq 递增触发一次追加，如聊天室点成员插「@名字」）；不传则无此行为。 */
  insert?: { readonly text: string; readonly seq: number } | undefined
}) {
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<'model' | 'effort' | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const boxRef = useRef<HTMLFormElement | null>(null)
  // byClaude-start 外部插入：seq 变化时把文本追加到草稿末尾并聚焦（byClaude）
  const insertSeq = insert?.seq ?? 0
  useEffect(() => {
    if (insertSeq === 0 || insert === undefined) return
    setDraft(prev => prev === '' ? insert.text : prev.replace(/\s+$/, '') + ' ' + insert.text)
    inputRef.current?.focus()
  }, [insertSeq])
  // byClaude-end
  const submit = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    onSubmit(text)
    setDraft('')
  }
  // 点到输入条外任意处收起下拉。
  useEffect(() => {
    if (menu === null) return
    const close = (event: MouseEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('mousedown', close) }
  }, [menu])
  const currentModel = catalog !== null && selection !== null
    ? (catalog.groups ?? []).flatMap(group => group.models ?? []).find(m => m.id === selection.model)
    : undefined
  const efforts = currentModel?.reasoning?.efforts ?? []
  const effortName = selection !== null
    ? efforts.find(e => e.id === selection.reasoningEffort)?.name ?? efforts.find(e => e.id === currentModel?.reasoning?.defaultEffort)?.name
    : undefined
  return (
    <form
      ref={boxRef}
      className="ask-box"
      aria-label={placeholder}
      onSubmit={event => { event.preventDefault(); submit() }}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={event => { setDraft(event.target.value) }}
        onFocus={() => { onFocusChange(true) }}
        onBlur={() => { onFocusChange(false) }}
      />
      <div className="ask-tools">
        {catalog !== null && selection !== null && (
          <div className="mpick-wrap">
            <button type="button" className="mpick" aria-haspopup="listbox" aria-expanded={menu === 'model'}
              onClick={() => { setMenu(menu === 'model' ? null : 'model') }}>
              <Icon n="bot" className="ic sm" />
              <span className="name">{currentModel?.name ?? selection.model}</span>
              <Icon n="chevron-down" className="ic xs" />
            </button>
            {menu === 'model' && (
              <div className="mpick-menu" role="listbox" aria-label={sendLabel}>
                {(catalog.groups ?? []).map(group => (
                  <div key={group.id}>
                    <div className="mpick-group">{group.name}</div>
                    {(group.models ?? []).map(m => (
                      <button key={m.id} type="button" role="option" aria-selected={selection.provider === group.id && selection.model === m.id}
                        className={`mpick-item${selection.provider === group.id && selection.model === m.id ? ' on' : ''}`}
                        onClick={() => {
                          setMenu(null)
                          onSelect({ provider: group.id, model: m.id, reasoningEffort: m.reasoning?.defaultEffort })
                        }}>
                        <span className="mpick-name">{m.name}</span>
                        {m.description !== undefined && <span className="mpick-sub">{m.description}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {efforts.length > 0 && selection !== null && (
          <div className="mpick-wrap">
            <button type="button" className="mpick" aria-haspopup="listbox" aria-expanded={menu === 'effort'}
              onClick={() => { setMenu(menu === 'effort' ? null : 'effort') }}>
              <Icon n="sparkles" className="ic sm" />
              <span className="name">{effortName ?? selection.reasoningEffort ?? ''}</span>
              <Icon n="chevron-down" className="ic xs" />
            </button>
            {menu === 'effort' && (
              <div className="mpick-menu" role="listbox">
                {efforts.map(e => (
                  <button key={e.id} type="button" role="option" aria-selected={selection.reasoningEffort === e.id}
                    className={`mpick-item${selection.reasoningEffort === e.id ? ' on' : ''}`}
                    onClick={() => { setMenu(null); onSelect({ ...selection, reasoningEffort: e.id }) }}>
                    <span className="mpick-name">{e.name}</span>
                    {e.description !== undefined && <span className="mpick-sub">{e.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="sp" />
        <button type="submit" className="send" aria-label={sendLabel} disabled={disabled}><Icon n="arrow-up" className="ic sm" /></button>
      </div>
    </form>
  )
}
// byClaude-end

/**
 * 大肥鱼管家面板（v10 · 交互稿 1:1）。
 * @param props - 会话目录、管家引用、跳转、子槽渲染面（SessionProvider + butler.chat）、文案。
 * @returns 工作台/控制台双视图 + 自绘输入条 + 官方完整对话浮层。
 */
export function ButlerPanel({
  useSessionList, useWorkspaceList, useSessionStatus, workspaceRaw, imControl, tasks, proposals, decideProposal, toggleAutonomy, acquire, acquireTeam, openSession, models, listSkills, t, renderSlot, SessionProvider,
}: ButlerPanelProps) {
  const [reference, setReference] = useState<SessionReference | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // byClaude-start 模型选择：目录就绪后恢复上次选择（localStorage），否则用目录默认（byClaude）
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogLike | null>(null)
  const [modelSelection, setModelSelection] = useState<ModelSelectionLike | null>(null)
  useEffect(() => {
    if (reference === undefined || models === null) return
    let alive = true
    void models.catalog().then(catalog => {
      if (!alive || catalog === null) return
      setModelCatalog(catalog)
      const saved = readStoredModel()
      const valid = saved !== null && (catalog.groups ?? []).some(g => g.id === saved.provider && (g.models ?? []).some(m => m.id === saved.model))
      setModelSelection(valid && saved !== null ? saved : catalog.default)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [reference, models])
  const applyModelSelection = useCallback((next: ModelSelectionLike) => {
    setModelSelection(next)
    try { window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(next)) } catch { /* 隐私模式等存储失败可忽略 */ }
    const id = reference?.sessionId
    if (id !== undefined && models !== null) void models.select(id, next)
  }, [reference, models])
  // byClaude-end
  const [doneMap, setDoneMap] = useState<Record<string, true>>(() => readDoneMap())
  const [ignoreMap, setIgnoreMap] = useState<Record<string, true>>(() => readIgnoreMap())
  // byClaude-start IM（钉钉机器人）开关：勾选真值 = dsh-im 快照里主 bot 的 enabled，勾/取消直接
  // bot.toggle（返回值即新快照，无轮询）。「已配置 IM」仍由标记工作区判定，但可勾还要求快照里
  // 存在 bot（stream 机器人没配 = 无从接入）；消息收发与自动回复全部发生在 dsh-im 内（byClaude）
  const [imBots, setImBots] = useState<readonly ImBotLike[] | null>(null)
  const [imBusy, setImBusy] = useState(false)
  const imSource = workspaceRaw
  const imConfigured = useSyncExternalStore(
    useCallback((onChange: () => void) => imSource.subscribe(onChange), [imSource]),
    useCallback(() => {
      try { return rawWorkspaceSnapshot().items.some(ws => isImHomePath(ws.path)) } catch { return false }
    }, []),
  )
  // 快照加载：面板挂载时一次；标记工作区晚到（host 播种是异步的）翻转成已配置时再补一次。
  useEffect(() => {
    if (imControl === null) return
    let alive = true
    void imControl.bots().then(next => { if (alive) setImBots(next) })
    return () => { alive = false }
  }, [imControl, imConfigured])
  const imBot = imBots !== null && imBots.length > 0 ? imBots[0] : undefined
  // 主 bot：IM 已连接且有 bot 才可勾；多 bot 时取首个，名称挂 title 上。
  const imPrimary = imConfigured && imBot !== undefined ? imBot : undefined
  const imOn = imPrimary !== undefined && imPrimary.enabled
  const imHint = !imConfigured ? t('im.missing')
    : imBots === null ? t('im.unavailable')
    : imBot === undefined ? t('im.nobot')
    : undefined
  const toggleIm = useCallback(() => {
    if (imPrimary === undefined || imBusy || imControl === null) return
    setImBusy(true)
    void imControl.toggle(imPrimary.id, imPrimary.revision, !imPrimary.enabled)
      .then(next => { if (next !== null) setImBots(next) })
      .finally(() => { setImBusy(false) })
  }, [imPrimary, imBusy, imControl])
  // byClaude-end
  const [detailOpen, setDetailOpen] = useState(false)
  const [view, setView] = useState<'workbench' | 'console' | 'team'>('console')
  // 生命感状态：attentive = 用户聚焦输入条（她在听）；bouncing = 一次性小跳。
  const [attentive, setAttentive] = useState(false)
  const [bouncing, setBouncing] = useState(false)
  const [justDoneIds, setJustDoneIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [toasts, setToasts] = useState<ReadonlyArray<{ readonly id: number; readonly text: string }>>([])
  const digestRef = useRef<HTMLDivElement | null>(null)
  const aliveRef = useRef(true)
  const detailBtnRef = useRef<HTMLButtonElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const wasDetailRef = useRef(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const card3dRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    let alive = true
    let owned: SessionReference | undefined
    acquire().then(ref => {
      if (!alive) {
        ref.release()
        return
      }
      owned = ref
      setReference(ref)
    }, () => {
      if (alive) setFailed(true)
    })
    return () => {
      alive = false
      owned?.release()
    }
  }, [acquire])

  const face = reference?.binding.session
  const events = reference?.binding.eventSource
  const running = useSnapshot(face, selectRunning)
  const digest = useSnapshot(events, selectRecentTurns)
  // byClaude-start 对话历史分页：窗口 hasMore + 本地可见条数（默认 30，上拉逐页放出）（byClaude）
  const eventsHasMore = useSnapshot(events, selectEventsHasMore)
  /** 思考过程滚动条：跑动中「此刻在干嘛」的实时尾部（思考/正文/工具调用）。 */
  const ticker = useSnapshot(events, selectLiveTicker)
  const [digestVisible, setDigestVisible] = useState(DIGEST_VISIBLE_INIT)
  const [digestLoadingOlder, setDigestLoadingOlder] = useState(false)
  const digestLoadingRef = useRef(false)
  // 会话换了（重开面板/新管家会话）：翻页状态回初始。
  useEffect(() => {
    setDigestVisible(DIGEST_VISIBLE_INIT)
  }, [reference?.sessionId])
  /**
   * 翻一页更早的消息：窗口里还有藏着的旧消息就再放 30 条；
   * 窗口放尽且 hasMore 才真正拉历史（session.loadOlder，一页 ≥50 条消息），
   * 到货后再放 30 条进视野。并发与重复触发由 digestLoadingRef 挡住。
   */
  const loadDigestOlder = useCallback(() => {
    if (digestLoadingRef.current) return
    if (digest.length > digestVisible) {
      setDigestVisible(previous => previous + DIGEST_PAGE)
      return
    }
    const session = reference?.binding.session
    if (session === undefined || !eventsHasMore) return
    digestLoadingRef.current = true
    setDigestLoadingOlder(true)
    void Promise.resolve(session.loadOlder())
      .catch(() => undefined)
      .finally(() => {
        digestLoadingRef.current = false
        setDigestLoadingOlder(false)
        // 历史页已 prepend 进窗口：放出下一页让用户看到刚拉的旧消息。
        setDigestVisible(previous => previous + DIGEST_PAGE)
      })
  }, [digest.length, digestVisible, eventsHasMore, reference])
  // byClaude-end
  const streaming = (digest.at(-1)?.streaming ?? false) === true
  /** 登录用户头像：宿主 UI 头像 img 与面板同 document，按 user-avatar src 特征取；取不到退回「我」。 */
  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  useEffect(() => {
    let tries = 0
    const timer = window.setInterval(() => {
      const img = document.querySelector<HTMLImageElement>('img[src*="user-avatar"]')
      if (img?.src !== undefined && img.src !== '') {
        setUserAvatar(img.src)
        window.clearInterval(timer)
        return
      }
      tries += 1
      if (tries >= 5) window.clearInterval(timer)
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])
  /** 三态情绪：工作 > 倾听 > 待机。 */
  const mood = running ? 'work' : attentive ? 'listen' : 'rest'

  // 她开口（流式首块）蹦一下。
  const prevStreamingRef = useRef(false)
  useEffect(() => {
    if (streaming && !prevStreamingRef.current) setBouncing(true)
    prevStreamingRef.current = streaming
  }, [streaming])

  // 用户刚发出一条消息（新 user 行）：她「收到」的一次轻蹦。
  const prevUserSeqRef = useRef(-1)
  const digestSeenRef = useRef(false)
  useEffect(() => {
    let userSeq = -1
    for (const row of digest) if (row.role === 'user') userSeq = row.seq
    if (digestSeenRef.current && userSeq > prevUserSeqRef.current) setBouncing(true)
    prevUserSeqRef.current = userSeq
    if (digest.length > 0) digestSeenRef.current = true
  }, [digest])

  // byClaude-start 消息流滚动（粘底跟随/翻页锚定/首屏落底）已移入 MsgList 自管：
  // 面板级「每次 digest 变化强制滚底」会打断翻历史，已删除（byClaude）

  // 蹦跳 1.5s 内自然收势。
  useEffect(() => {
    if (!bouncing) return
    const timer = window.setTimeout(() => { if (aliveRef.current) setBouncing(false) }, 1500)
    return () => { window.clearTimeout(timer) }
  }, [bouncing])

  // 待机生命感调度：rest 态下随机小蹦跳或头顶冒一句短语；工作/倾听时不打扰。
  const moodRef = useRef(mood)
  moodRef.current = mood
  const bouncingRef = useRef(bouncing)
  bouncingRef.current = bouncing
  const [sayIdx, setSayIdx] = useState<number | null>(null)
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (moodRef.current !== 'rest' || !aliveRef.current || bouncingRef.current) return
      const roll = Math.random()
      if (roll < 0.35) {
        setBouncing(true)
      } else if (roll < 0.6 && sayIdx === null) {
        setSayIdx(Math.floor(Math.random() * SAY_KEYS.length))
        window.setTimeout(() => { if (aliveRef.current) setSayIdx(null) }, 2600)
      }
    }, 9000)
    return () => { window.clearInterval(tick) }
  }, [sayIdx])

  // 详细层 Esc 收起；焦点在开/关按钮之间进层。
  useEffect(() => {
    if (detailOpen) {
      closeBtnRef.current?.focus()
      wasDetailRef.current = true
    } else if (wasDetailRef.current) {
      detailBtnRef.current?.focus()
      wasDetailRef.current = false
    }
  }, [detailOpen])
  useEffect(() => {
    if (!detailOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') setDetailOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [detailOpen])

  // 整表对象在两次失效之间引用稳定，派生看板用 useMemo 缓存。
  const listState = useSessionList(value => value)
  const workspaceState = useWorkspaceList(value => value)

  // byClaude-start 派活台账轮询（host 完成检测的数据面）：挂载即拉一次，之后每 10s；
  // 拉不到（老宿主/路由缺席）保持 null，自动汇报相关 UI 整体退场（byClaude）
  const [taskReports, setTaskReports] = useState<readonly TaskReport[] | null>(null)
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      void tasks().then(next => { if (alive) setTaskReports(next) }).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 10_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [tasks])
  // byClaude-end
  // byClaude-start 管家提议轮询（自主性的数据面）：挂载即拉一次，之后每 10s；
  // 拉不到保持 null，「管家提议」组与心跳行整体退场。裁决后局部刷新 + busy 防连点（byClaude）
  const [proposalReports, setProposalReports] = useState<readonly ProposalReport[] | null>(null)
  const [autonomyStatus, setAutonomyStatus] = useState<AutonomyStatus | undefined>(undefined)
  const [proposalBusy, setProposalBusy] = useState<string | undefined>(undefined)
  const [autonomyBusy, setAutonomyBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const pull = (): void => {
      void proposals().then(next => {
        if (!alive) return
        setProposalReports(next?.list ?? null)
        setAutonomyStatus(next?.autonomy)
      }).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 10_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [proposals])
  /** 待裁决提议（创建时间倒序全量；自主模块内嵌最新 3 条、多出折叠成计数）。 */
  const pendingProposals = useMemo(() =>
    [...(proposalReports ?? [])]
      .filter(row => row.status === 'pending')
      .sort((left, right) => right.createdAt - left.createdAt), [proposalReports])
  /** 自主循环心跳由 AutonomyMind 模块直接消费（v3 A 卡三态），不再单独拼状态行。 */
  /** 提议裁决：approve 成功即跳执行会话；失败 toast 透传端点真实原因，裁决后立即刷新台账。 */
  const onProposalDecision = (id: string, action: 'approve' | 'ignore'): void => {
    setProposalBusy(id)
    void decideProposal(id, action)
      .catch(() => null)
      .then(outcome => {
        setProposalBusy(undefined)
        if (outcome === null) { toast(t('proposals.fail')); return }
        if (!outcome.ok) { toast(`${t('proposals.fail')}：${outcome.message}`); return }
        if (action === 'approve') {
          toast(t('proposals.approved'))
          if (outcome.proposal?.sessionId !== undefined) openSession(outcome.proposal.sessionId as SessionId)
        } else {
          toast(t('proposals.ignored'))
        }
        void proposals().then(next => {
          setProposalReports(next?.list ?? null)
          setAutonomyStatus(next?.autonomy)
        }).catch(() => undefined)
      })
  }
  /** 自主性总开关：成功就地更新心跳（A 卡立即换形态），失败 toast 透传原因。 */
  const onAutonomyToggle = (enabled: boolean): void => {
    if (autonomyBusy) return
    setAutonomyBusy(true)
    void toggleAutonomy(enabled)
      .catch(() => null)
      .then(outcome => {
        setAutonomyBusy(false)
        if (outcome === null) { toast(t('autonomy.switch.fail')); return }
        if (!outcome.ok) { toast(`${t('autonomy.switch.fail')}：${outcome.message}`); return }
        if (outcome.autonomy !== undefined) setAutonomyStatus(outcome.autonomy)
        else if (autonomyStatus !== undefined) setAutonomyStatus({ ...autonomyStatus, enabled })
        toast(enabled ? t('autonomy.switch.on.done') : t('autonomy.switch.off.done'))
      })
  }
  // byClaude-end
  /** 台账 done 表：sessionId → 完成汇报（带总结或原因注记）。 */
  const ledgerDoneMap = useMemo(() => {
    const map = new Map<string, TaskReport>()
    for (const report of taskReports ?? []) if (report.status === 'done') map.set(report.sessionId, report)
    return map
  }, [taskReports])
  /** 台账 waiting-input 表：sessionId → 等交互汇报（批准/答题等主人处理）。 */
  const ledgerWaitingMap = useMemo(() => {
    const map = new Map<string, TaskReport>()
    for (const report of taskReports ?? []) if (report.status === 'waiting-input') map.set(report.sessionId, report)
    return map
  }, [taskReports])
  /** 台账已完成条目（完成时间倒序，取最近 6 条进工作台列表）。 */
  const autoDone = useMemo(() =>
    [...ledgerDoneMap.values()]
      .sort((left, right) => (right.completedAt ?? right.dispatchedAt) - (left.completedAt ?? left.dispatchedAt))
      .slice(0, 6), [ledgerDoneMap])
  /** 台账等交互条目（最近派活在前）。 */
  const autoWaiting = useMemo(() =>
    [...ledgerWaitingMap.values()]
      .sort((left, right) => right.dispatchedAt - left.dispatchedAt), [ledgerWaitingMap])
  // byClaude-end

  const board = useMemo(() => {
    const butlerId = reference?.sessionId
    const archived = new Set(workspaceState.archivedSessionIds)
    // 管家之家整个工作区与管家标题的旧会话都不进看板：看板只看用户的活。
    const rows = listState.ids
      .map(id => listState.byId[id])
      .filter((row): row is SessionSummary =>
        row !== undefined && !row.blank && row.origin !== 'subagent'
        && row.id !== butlerId && !archived.has(row.id)
        && !isButlerHomePath(row.cwd ?? '') && row.title !== BUTLER_TITLE
        && (row.title ?? '').startsWith(TEAM_SESSION_PREFIX) === false)
    const byRecent = (left: SessionSummary, right: SessionSummary) => right.updatedAt - left.updatedAt
    // 被忽略的会话从看板整个消失（不算完成，也不进任何分组）。
    const visible = rows.filter(row => ignoreMap[row.id] === undefined)
    const ongoing = visible.filter(row => row.running).sort(byRecent)
    // byClaude-start 台账已判完成/等交互的会话不再进「待确认」（它们有各自的汇报分组）（byClaude）
    const pending = visible.filter(row =>
      !row.running && doneMap[row.id] === undefined
      && ledgerDoneMap.get(row.id) === undefined && ledgerWaitingMap.get(row.id) === undefined
      && Date.now() - row.updatedAt < PENDING_WINDOW_MS)
      .sort(byRecent)
    // byClaude-end
    const done = visible
      .filter(row => !ongoing.includes(row) && !pending.includes(row))
      .sort(byRecent)
      .slice(0, DONE_LIST_CAP)
    return { ongoing, pending, done }
  }, [listState, workspaceState, doneMap, ignoreMap, reference?.sessionId, ledgerDoneMap, ledgerWaitingMap])

  // byClaude-start 执行流单列时间序：三组（进行中/待确认/已完成）合并成一条按
  // 最后活跃时间（updatedAt 降序）排的列表，最近 20 个一页；行上仍带各自 stage
  // 徽标。页码在列表缩短时钳到最后一页，不额外开 effect（byClaude）
  const [flowPage, setFlowPage] = useState(0)
  const flowRows = useMemo(() => {
    const stageOf = new Map<string, 'ongoing' | 'pending' | 'done'>()
    for (const row of board.ongoing) stageOf.set(row.id, 'ongoing')
    for (const row of board.pending) stageOf.set(row.id, 'pending')
    for (const row of board.done) stageOf.set(row.id, 'done')
    return [...board.ongoing, ...board.pending, ...board.done]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      // byClaude-start 台账汇报随行：done 行带总结/注记、waiting-input 行带等待提示（byClaude）
      .map(row => ({
        row,
        stage: stageOf.get(row.id) ?? 'done',
        report: ledgerDoneMap.get(row.id) ?? ledgerWaitingMap.get(row.id),
      }))
      // byClaude-end
  }, [board, ledgerDoneMap, ledgerWaitingMap])
  const flowPageCount = Math.max(1, Math.ceil(flowRows.length / FLOW_PAGE_SIZE))
  const flowPageIndex = Math.min(flowPage, flowPageCount - 1)
  const flowPageRows = flowRows.slice(flowPageIndex * FLOW_PAGE_SIZE, (flowPageIndex + 1) * FLOW_PAGE_SIZE)
  // byClaude-end

  // byClaude-start 人机交互拦截：宿主把 approval/question 挂在 SessionStatus.pendingInteraction，
  // 官方卡片只进 Conversation 视图；面板自取全表投影成拦截卡（管家会话优先，最多 3 张）。
  // useSessionStatus 由 ui-session 标准面注入（boot 级，面板渲染前就绪）；
  // 可选链防御极端未注册态：挂载后 props 引用稳定，不构成条件 hook。
  const statusMap = useSessionStatus?.(value => value)
  const interceptCards = useMemo(() => {
    const butlerId = reference?.sessionId
    const cards: InterceptCard[] = []
    for (const [sessionId, status] of statusMap ?? []) {
      const it = status?.pendingInteraction
      if (it === undefined || it === null || typeof it !== 'object') continue
      const loose = it as unknown as ApprovalInteractionLike & OtherInteractionLike
      if (typeof loose.key !== 'string') continue
      const isApproval = loose.kind === 'approval' && typeof loose.answer === 'function'
      const question = Array.isArray(loose.questions) ? loose.questions[0]?.question : undefined
      cards.push({
        sessionId,
        key: loose.key,
        kind: loose.kind,
        approval: isApproval ? loose : undefined,
        firstQuestion: typeof question === 'string' ? question : undefined,
        isButler: sessionId === butlerId,
        title: listState.byId[sessionId]?.title,
      })
    }
    cards.sort((left, right) => (Number(right.isButler) - Number(left.isButler)) || left.key.localeCompare(right.key))
    return cards
  }, [statusMap, listState, reference?.sessionId])
  const settleApproval = useCallback((card: InterceptCard, outcome: 'allowed-once' | 'rejected') => {
    const approval = card.approval
    if (approval === undefined || approval.answerable === false) return
    void approval.answer?.(outcome).catch(() => undefined)
  }, [])
  const interceptBar = (
    <InterceptBar
      cards={interceptCards}
      allowLabel={t('intercept.approve.allow')}
      rejectLabel={t('intercept.approve.reject')}
      goLabel={t('intercept.question.go')}
      approveTitle={t('intercept.approve')}
      questionTitle={t('intercept.question')}
      butlerLabel={t('intercept.butler')}
      onAllow={card => { settleApproval(card, 'allowed-once') }}
      onReject={card => { settleApproval(card, 'rejected') }}
      onOpen={openSession}
    />
  )
  // byClaude-end

  // 有对话从进行中离开（完成/中断）：该卡高亮脉冲一次 + 她蹦一下（她注意到了）。
  const prevOngoingRef = useRef<readonly SessionId[] | null>(null)
  useEffect(() => {
    const prev = prevOngoingRef.current
    const now = board.ongoing.map(row => row.id)
    prevOngoingRef.current = now
    if (prev === null) return
    const nowSet = new Set<SessionId>(now)
    const finished = prev.filter(id => !nowSet.has(id))
    if (finished.length === 0) return
    setJustDoneIds(new Set(finished))
    setBouncing(true)
    const timer = window.setTimeout(() => { setJustDoneIds(new Set()) }, 1500)
    return () => { window.clearTimeout(timer) }
  }, [board.ongoing])

  /** 右下角轻通知：2.6s 自灭（确认语言的一部分，不弹跳打扰）。 */
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts(previous => [...previous, { id, text }])
    window.setTimeout(() => {
      if (aliveRef.current) setToasts(previous => previous.filter(item => item.id !== id))
    }, 2600)
  }, [])

  // byClaude-start 派活完成自动汇报的到场反馈：轮询发现新的台账 done（上一拍还没有）
  // → 她蹦一下 + 右下角 toast 报总结 + 完成卡脉冲（与手动收尾同一套确认语言）（byClaude）
  const prevLedgerDoneRef = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    const ids = new Set(ledgerDoneMap.keys())
    const prev = prevLedgerDoneRef.current
    prevLedgerDoneRef.current = ids
    if (prev === null) return // 首拍只记基线（历史完成不轰炸）。
    const fresh = [...ids].filter(id => !prev.has(id))
    if (fresh.length === 0) return
    setBouncing(true)
    setJustDoneIds(new Set(fresh))
    window.setTimeout(() => { if (aliveRef.current) setJustDoneIds(new Set()) }, 1500)
    for (const id of fresh.slice(0, 3)) {
      const report = ledgerDoneMap.get(id)
      if (report === undefined) continue
      const title = report.title ?? listState.byId[id as SessionId]?.title ?? id.slice(0, 8)
      const tail = report.summary ?? (report.note !== undefined ? t(`tasks.note.${report.note}`) : t('tasks.noSummary'))
      toast(`${t('toast.taskDone').replace('{title}', title)}：${tail.slice(0, 80)}`)
    }
  }, [ledgerDoneMap, listState, t, toast])
  // byClaude-end

  // byClaude-start 等交互到场的提醒：轮询发现新的 waiting-input（上一拍还没有）
  // → 蹦一下 + toast 报「任务等你处理」；主人答完任务恢复时保持安静（完成另有播报）（byClaude）
  const prevLedgerWaitingRef = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    const ids = new Set(ledgerWaitingMap.keys())
    const prev = prevLedgerWaitingRef.current
    prevLedgerWaitingRef.current = ids
    if (prev === null) return // 首拍只记基线。
    const fresh = [...ids].filter(id => !prev.has(id))
    if (fresh.length === 0) return
    setBouncing(true)
    for (const id of fresh.slice(0, 3)) {
      const report = ledgerWaitingMap.get(id)
      if (report === undefined) continue
      const title = report.title ?? listState.byId[id as SessionId]?.title ?? id.slice(0, 8)
      toast(`${t('toast.taskWaiting').replace('{title}', title)}（${t(`tasks.waiting.${report.pendingKind ?? 'other'}`)}）`)
    }
  }, [ledgerWaitingMap, listState, t, toast])
  // byClaude-end

  // 「已完成」覆盖表只算纯更新；持久化放副作用里（StrictMode 双调不双写坏状态）。
  const markDone = useCallback((id: SessionId, title: string) => {
    setDoneMap(previous => {
      // 最近 DONE_LIST_CAP 条之外的最旧项自然淘汰；写入幂等。
      const entries = Object.entries({ ...previous, [id]: true as const })
      return Object.fromEntries(entries.slice(-DONE_LIST_CAP))
    })
    // 手动收尾与自动完成共享同一套确认语言：卡脉冲一次 + 她的小跳 + toast 落账。
    setJustDoneIds(new Set([id]))
    setBouncing(true)
    toast(t('toast.markDone').replace('{title}', title))
    window.setTimeout(() => { if (aliveRef.current) setJustDoneIds(new Set()) }, 1500)
  }, [t, toast])
  useEffect(() => {
    window.localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(doneMap))
  }, [doneMap])

  // 「已忽略」表：明示不关心的会话从看板整个隐藏；只写一次，重进面板不再追问。
  const ignoreSession = useCallback((id: SessionId, title: string) => {
    setIgnoreMap(previous => ({ ...previous, [id]: true as const }))
    toast(t('toast.ignored').replace('{title}', title))
  }, [t, toast])
  useEffect(() => {
    window.localStorage.setItem(IGNORE_STORAGE_KEY, JSON.stringify(ignoreMap))
  }, [ignoreMap])

  // 输入条与快捷指令直发：不经官方 composer 草稿态，直接排进管家会话队列。
  // byClaude-start 跳原生对话页：hero 思考横幅与对话面板头共用（byClaude）
  const openButlerChat = useCallback(() => {
    const id = reference?.sessionId
    if (id !== undefined) openSession(id)
  }, [reference, openSession])
  // byClaude-end
  const sendText = useCallback((raw: string) => {    const text = raw.trim()
    if (text === '' || reference === undefined) return
    const session = reference.binding.session
    const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] })
    void session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId)
      .then(result => {
        if (!aliveRef.current) return
        if (!result.ok) submission.abandon()
      }, () => {
        submission.abandon()
      })
  }, [reference])

  // byClaude-start agent team 聊天室：群消息状态、成员会话引用池、@派发与回复采集（byClaude）
  const [teamLog, setTeamLog] = useState<readonly TeamMessage[]>(() => readTeamLog())
  const teamLogRef = useRef(teamLog)
  teamLogRef.current = teamLog
  const teamRefs = useRef(new Map<string, SessionReference>())
  const teamNextId = useRef(1)
  const teamScrollRef = useRef<HTMLDivElement | null>(null)
  const [teamInsert, setTeamInsert] = useState<{ readonly text: string; readonly seq: number } | undefined>(undefined)
  const teamInsertSeq = useRef(0)
  // byClaude-start 成员编辑：本地人格/技能覆盖 + 编辑浮层状态（byClaude）
  const [teamOverrides, setTeamOverrides] = useState<Record<string, TeamOverride>>(() => readTeamOverrides())
  const teamOverridesRef = useRef(teamOverrides)
  teamOverridesRef.current = teamOverrides
  const [editingAgent, setEditingAgent] = useState<TeamAgentDef | null>(null)
  const [draftPersona, setDraftPersona] = useState('')
  const [draftSkills, setDraftSkills] = useState('')
  // byClaude-start 技能目录：打开编辑器时拉一次（管家会话就绪为前提）；勾选集 ↔ 逗号串互转（byClaude）
  const [skillOptions, setSkillOptions] = useState<readonly { name: string; description?: string }[] | null>(null)
  useEffect(() => {
    if (editingAgent === null || reference === undefined) { setSkillOptions(null); return }
    let alive = true
    setSkillOptions(null)
    void listSkills(reference.sessionId).then(skills => {
      if (alive) setSkillOptions(skills)
    }).catch(() => { if (alive) setSkillOptions(null) })
    return () => { alive = false }
  }, [editingAgent, reference, listSkills])
  const draftSkillList = useMemo(
    () => draftSkills.split(/[,\n]/).map(part => part.trim()).filter(part => part !== ''),
    [draftSkills],
  )
  const toggleSkill = useCallback((name: string): void => {
    setDraftSkills(prev => {
      const set = new Set(prev.split(/[,\n]/).map(p => p.trim()).filter(p => p !== ''))
      if (set.has(name)) set.delete(name)
      else set.add(name)
      return [...set].join(', ')
    })
  }, [])
  // byClaude-end
  const openAgentEditor = useCallback((agent: TeamAgentDef): void => {
    const saved = teamOverridesRef.current[agent.id]
    // 预填内置人格全文：主人直接在默认值上改，而不是面对空框猜格式。
    setDraftPersona(saved?.persona ?? TEAM_PERSONAS_ALL[agent.id] ?? '')
    setDraftSkills(saved?.skills ?? '')
    setEditingAgent(agent)
  }, [])
  const saveAgentOverride = useCallback((): void => {
    const agent = editingAgent
    if (agent === null) return
    setTeamOverrides(prev => {
      const next = { ...prev }
      const persona = draftPersona.trim()
      const skills = draftSkills.trim()
      const unchanged = persona === (TEAM_PERSONAS_ALL[agent.id] ?? '').trim() && skills === ''
      if (unchanged) delete next[agent.id]
      else next[agent.id] = { persona, skills }
      persistTeamOverrides(next)
      return next
    })
    setEditingAgent(null)
    toast(t('team.edit.saved'))
  }, [editingAgent, draftPersona, draftSkills, toast, t])
  const resetAgentOverride = useCallback((): void => {
    const agent = editingAgent
    if (agent === null) return
    setTeamOverrides(prev => {
      const next = { ...prev }
      delete next[agent.id]
      persistTeamOverrides(next)
      return next
    })
    setEditingAgent(null)
    toast(t('team.edit.resetDone'))
  }, [editingAgent, toast, t])
  // byClaude-end

  // 面板卸载时释放全部成员引用（引用池生命周期 = 面板挂载期）。
  useEffect(() => () => {
    for (const ref of teamRefs.current.values()) ref.release()
    teamRefs.current.clear()
  }, [])

  // 群消息落地（持久化排除 pending/error 态）与 pending 行更新。
  const appendTeamLog = useCallback((row: TeamMessage): void => {
    setTeamLog(prev => {
      const next = [...prev, row]
      persistTeamLog(next)
      return next
    })
  }, [])
  const patchTeamLog = useCallback((id: number, patch: Partial<TeamMessage>): void => {
    setTeamLog(prev => {
      const next = prev.map(row => row.id === id ? { ...row, ...patch, pending: patch.pending ?? false } : row)
      persistTeamLog(next)
      return next
    })
  }, [])

  // 成员会话引用：懒 acquire + 进程内缓存（acquire 幂等 retain 计数，重复调用无害）。
  const acquireTeamRef = useCallback(async (agentId: string): Promise<SessionReference> => {
    const cached = teamRefs.current.get(agentId)
    if (cached !== undefined) return cached
    const ref = await acquireTeam(agentId)
    teamRefs.current.set(agentId, ref)
    return ref
  }, [acquireTeam])

  /**
   * 订阅成员事件流等本轮回复：出现 since 之后的完整 assistant 行且流式已停 → 收文；
   * 120s 兜底超时标失败。unsubscribe 与超时 timer 由面板卸载与完成路径双清。
   */
  const watchTeamReply = useCallback((ref: SessionReference, pid: number, since: number, done: () => void): void => {
    const events = ref.binding.eventSource
    let timer = 0
    let unsubscribe: () => void = () => {}
    const finish = (patch: Partial<TeamMessage>): void => {
      window.clearTimeout(timer)
      unsubscribe()
      patchTeamLog(pid, patch)
      done()
    }
    const check = (): void => {
      const snapshot = events.getSnapshot()
      if (teamStreamingActive(snapshot)) return
      const reply = lastAssistantReplySince(snapshot, since)
      if (reply !== undefined) finish({ text: reply })
    }
    unsubscribe = events.subscribe(() => { check() })
    timer = window.setTimeout(() => { finish({ error: true, text: '' }) }, 120000)
    check()
  }, [patchTeamLog])

  /**
   * 给一个成员派话：拼接群聊共享上下文 + 主人 @ 语，走该成员独立会话；
   * 占位行先行，回复由 watchTeamReply 收尾。
   */
  const dispatchTeamAgent = useCallback(async (agentId: string, text: string, pid: number): Promise<void> => {
    let ref: SessionReference
    try {
      ref = await acquireTeamRef(agentId)
    } catch {
      patchTeamLog(pid, { error: true, text: t('team.error.session') })
      return
    }
    const history = teamContextTranscript(teamLogRef.current, 24)
    // 主人编辑版角色/技能覆盖：存在时置于 prompt 首位，优先级高于工作区 AGENTS.md。
    const override = teamOverridesRef.current[agentId]
    const overrideHead = override === undefined ? '' : (
      `${t('team.ovr.head')}\n${override.persona}\n${t('team.ovr.skills')}\n${override.skills}\n\n`
    )
    const prompt = overrideHead + (history === ''
      ? `${t('team.ctx.head')}\n\n${t('team.ctx.at')}${text}`
      : `${t('team.ctx.head')}\n${history}\n\n${t('team.ctx.at')}${text}`)
    const since = Date.now()
    const session = ref.binding.session
    const submission = session.beginSubmission({ mode: 'queue', text: prompt, attachments: [] })
    try {
      await session.prompt([{ type: 'text', text: prompt }], 'queue', undefined, submission.requestId)
    } catch {
      submission.abandon()
      patchTeamLog(pid, { error: true, text: t('team.error.send') })
      return
    }
    watchTeamReply(ref, pid, since, () => undefined)
  }, [acquireTeamRef, patchTeamLog, watchTeamReply, t])

  /** 聊天室发送：主人消息入群，@到谁派谁（没人 @ 到就喊默认成员）。 */
  const sendTeam = useCallback((raw: string): void => {
    const text = raw.trim()
    if (text === '') return
    const mentions = parseTeamMentions(text)
    appendTeamLog({ id: teamNextId.current++, from: 'me', text, time: Date.now() })
    for (const agentId of mentions) {
      const pid = teamNextId.current++
      appendTeamLog({ id: pid, from: agentId, text: '', time: Date.now(), pending: true })
      void dispatchTeamAgent(agentId, text, pid)
    }
  }, [appendTeamLog, dispatchTeamAgent])

  // 群消息更新后滚到底部。
  useEffect(() => {
    const node = teamScrollRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [teamLog])

  // 成员条点击：把「@名字」插进输入条。
  const onRosterPick = useCallback((agent: TeamAgentDef): void => {
    teamInsertSeq.current += 1
    setTeamInsert({ text: `@${agent.name} `, seq: teamInsertSeq.current })
  }, [])
  // byClaude-end

  // 舞台 3D 倾斜（设计稿 tilt）：指针跟随 ±8°/±6°，离开回正；触屏与 reduced-motion 不启用。
  const tiltEnabled = useMemo(() =>
    typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const onStagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!tiltEnabled) return
    const card = card3dRef.current
    const stage = stageRef.current
    if (card === null || stage === null) return
    const rect = stage.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    card.style.transform = `rotateY(${(px * 12).toFixed(2)}deg) rotateX(${(-py * 8).toFixed(2)}deg)`
  }, [tiltEnabled])
  const onStagePointerLeave = useCallback(() => {
    const card = card3dRef.current
    if (card !== null) card.style.transform = ''
  }, [])

  const greeting = t(greetingKey(new Date()))
  const watching = board.ongoing.length + board.pending.length + board.done.length
  // byClaude-start 控制台思考横幅：跑着时是「思考过程滚动条」（reasoning/正文尾部、
  // 工具调用名，随流式刷新，单行滚动）；空闲回落到最新一条管家输出（两行钳制）（byClaude）
  let thought = t('cap.idle')
  for (const row of digest) if (row.role === 'butler') thought = row.text
  let thoughtLive = false
  if (running && ticker !== undefined) {
    thoughtLive = true
    if (ticker.kind === 'tool') {
      thought = ticker.text !== '' ? t('hero.tool').replace('{name}', ticker.text) : t('butler.thinking')
    } else {
      thought = ticker.truncated ? `…${ticker.text}` : ticker.text
    }
  }
  // byClaude-end

  const chat = reference !== undefined
    ? <SessionProvider session={reference}>{renderSlot('dafeiyu.butler.chat', {})}</SessionProvider>
    : null

  const moodDot = mood === 'work' ? 'dfy-dot-run' : mood === 'listen' ? 'dfy-dot-listen' : 'dot-ok'
  const moodText = mood === 'work' ? t('badge.thinking') : mood === 'listen' ? t('badge.listening') : t('badge.idle')

  // byClaude-start 消息流只渲染最近 digestVisible 条（默认 30）；顶部还有更早消息时
  // 交给翻页（窗口内翻页 + loadOlder 拉历史），提示行由 MsgList 渲染（byClaude）
  const digestView = digest.slice(-digestVisible)
  const msgList = (
    <MsgList
      rows={failed ? [] : digestView}
      running={running}
      thinking={t('butler.thinking')}
      t={t}
      digestRef={digestRef}
      userAvatar={userAvatar}
      paging={{
        more: !failed && (digest.length > digestVisible || eventsHasMore),
        loading: digestLoadingOlder,
        onReachTop: loadDigestOlder,
      }}
    />
  )
  // byClaude-end

  return (
    <div className="dfy-root">
      <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }} dangerouslySetInnerHTML={{ __html: SVG_DEFS }} />
      <style dangerouslySetInnerHTML={{ __html: BOARD_CSS }} />
      <div className="aurora" aria-hidden="true"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <div className="dfy-deco" aria-hidden="true">
        <i className="dd d1" /><i className="dd p d2" /><i className="dd k d3" /><i className="dd d4" /><i className="dd p d5" />
        <i className="dd k d6" /><i className="dd d7" /><i className="dd p d8" /><i className="dd d9" />
        <i className="dd h d10" /><i className="dd d11" /><i className="dd h d12" /><i className="dd d13" /><i className="dd d14" /><i className="dd h d15" /><i className="dd d16" />
        <span className="df f1"><span className="dfi"><Icon n="fish" /></span></span>
        <span className="df f2"><span className="dfi"><Icon n="fish" /></span></span>
        <span className="dg g1"><i /><i /><i /></span>
        <span className="dg g2"><i /><i /><i /></span>
      </div>
      <div className="dfy-viewbar">
        <nav className="view-switch" aria-label={t('view.switch')}>
          <button type="button" className={view === 'workbench' ? 'vs-btn active' : 'vs-btn'}
            aria-pressed={view === 'workbench'} onClick={() => { setView('workbench') }}>
            <Icon n="message-circle" className="ic sm" />{t('view.workbench')}
          </button>
          <button type="button" className={view === 'console' ? 'vs-btn active' : 'vs-btn'}
            aria-pressed={view === 'console'} onClick={() => { setView('console') }}>
            <Icon n="activity" className="ic sm" />{t('view.console')}
          </button>
          {/* byClaude-start 聊天室第三视图入口（byClaude） */}
          <button type="button" className={view === 'team' ? 'vs-btn active' : 'vs-btn'}
            aria-pressed={view === 'team'} onClick={() => { setView('team') }}>
            <Icon n="bot" className="ic sm" />{t('view.team')}
          </button>
          {/* byClaude-end */}
        </nav>
        {/* byClaude-start IM（钉钉机器人）开关：勾 = bot.toggle 起停 stream 监听；旁挂监听状态灯（byClaude） */}
        <label
          className={`dfy-im-toggle${imPrimary !== undefined && !imBusy ? '' : ' off'}`}
          title={imPrimary !== undefined
            ? `${imPrimary.name} · ${t(`im.status.${imPrimary.listenerStatus}`)}`
              + (imPrimary.listenerStatus === 'error' && imPrimary.lastError !== undefined ? `：${imPrimary.lastError}` : '')
            : imHint}
        >
          <input
            type="checkbox"
            checked={imOn}
            disabled={imPrimary === undefined || imBusy}
            aria-label={t('im.toggle')}
            onChange={toggleIm}
          />
          <span>{t('im.toggle')}</span>
          {imPrimary !== undefined && (
            <em className={`dfy-im-dot dfy-im-${imPrimary.listenerStatus}`} aria-hidden="true" />
          )}
          {imPrimary === undefined && imHint !== undefined && <em className="dfy-im-hint">{imHint}</em>}
        </label>
        {/* byClaude-end */}
        <span className="chip chip-ok">
          <span className={`dot ${moodDot}`} aria-hidden="true" />{moodText}
        </span>
      </div>

      {view === 'workbench' ? (
        <section id="view-workbench" className="view wb" aria-label={t('view.workbench')}>
          <main className="wb-main">
          <div className="greet-row">
            <h1 className="greet">{greeting}，<span className="grad">{t('butler.name')}</span></h1>
            <span className="chip chip-ok" style={{ marginLeft: 'auto' }}>
              <span className={`dot ${moodDot}`} aria-hidden="true" />{moodText}
            </span>
          </div>
          <div className="v1-work">
            <section className="work-chat" aria-label={t('panel.chat')}>
              <div
                className={`panel-h${reference !== undefined ? ' clickable' : ''}`}
                title={reference !== undefined ? t('hero.openChat') : undefined}
                onClick={reference !== undefined ? openButlerChat : undefined}
              >
                <Icon n="message-circle" className="ic sm" />{t('panel.chat')} · {t('butler.name')}
                <span className="sp" />
                {reference !== undefined && (
                  <button ref={detailBtnRef} type="button" className="dfy-open-detail" onClick={() => { setDetailOpen(true) }}>
                    {t('chat.detail')} <Icon n="chevron-down" className="ic xs" />
                  </button>
                )}
              </div>
              {failed
                ? <div className="dfy-center-note">{t('butler.error')}</div>
                : digest.length === 0 && reference === undefined
                  ? <div className="dfy-center-note">{t('butler.loading')}</div>
                  : (
                    <div className="chat-body">
                      <div
                        ref={stageRef}
                        className={`work-stage${bouncing ? ' stage-hop' : ''}`}
                        data-mood={mood}
                        onPointerMove={onStagePointerMove}
                        onPointerLeave={onStagePointerLeave}
                      >
                        <div className="stage-halo" aria-hidden="true" />
                        <div className="stage-ring" aria-hidden="true" />
                        <div className="stage-float">
                          <div ref={card3dRef} className="stage-card">
                            <ButlerFish size={182} running={running} />
                          </div>
                        </div>
                        <div className="stage-shadow" aria-hidden="true" />
                        {sayIdx !== null && (
                          <div className="stage-say" aria-hidden="true">{t(SAY_KEYS[sayIdx] ?? SAY_KEYS[0])}</div>
                        )}
                        <span className="bub b1" aria-hidden="true" /><span className="bub b2" aria-hidden="true" /><span className="bub b3" aria-hidden="true" />
                        <div className="stage-cap">
                          <span className={`dot ${moodDot}`} aria-hidden="true" />
                          {mood === 'work' ? t('cap.thinking') : mood === 'listen' ? t('cap.listening') : t('cap.idle')}
                        </div>
                      </div>
                      {msgList}
                    </div>
                  )}
            </section>
            <section className="work-tasks" aria-label={t('tasks.title')}>
              <div className="panel-h"><Icon n="activity" className="ic sm" />{t('tasks.title')}</div>
              <div className="flow-scroll">
                {/* byClaude-start 自主意识模块（v3 A 卡）：巡检心跳 + 新需求就地裁决，
                    渐变玻璃卡 + 分区线与执行流（会话列表）区隔（byClaude） */}
                <AutonomyMind status={autonomyStatus} pending={pendingProposals}
                  busy={proposalBusy} onDecision={onProposalDecision}
                  onToggle={onAutonomyToggle} toggleBusy={autonomyBusy} t={t} />
                <div className="mind-cut" aria-hidden="true" />
                {/* byClaude-end */}
                <div className="flow-label"><span className="gdot cyan" aria-hidden="true" />{t('stage.ongoing')}</div>
                {board.ongoing.length === 0
                  ? <div className="dfy-empty-row">{t('board.empty.ongoing')}</div>
                  : board.ongoing.map(row => (
                    <TaskCard key={row.id} row={row} stage="ongoing" just={justDoneIds.has(row.id)} t={t}
                      onOpen={() => { openSession(row.id) }}
                      onApprove={() => { markDone(row.id, row.displayTitle) }}
                      onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                  ))}
                {/* byClaude-start 派活台账的等交互汇报组：任务在等批准/答题时落到这里（byClaude） */}
                {autoWaiting.length > 0 && (
                  <>
                    <div className="flow-label"><span className="gdot amber" aria-hidden="true" />{t('tasks.waiting.label')}</div>
                    {autoWaiting.map(report => {
                      const row = listState.byId[report.sessionId as SessionId]
                      const title = report.title ?? row?.title ?? report.sessionId.slice(0, 8)
                      return (
                        <WaitCard key={report.sessionId} report={report} title={title} t={t}
                          onOpen={() => { openSession(report.sessionId as SessionId) }} />
                      )
                    })}
                  </>
                )}
                {/* byClaude-end */}
                <div className="flow-label"><span className="gdot amber" aria-hidden="true" />{t('stage.pending')}</div>
                {board.pending.length === 0
                  ? <div className="dfy-empty-row">{t('board.empty.pending')}</div>
                  : board.pending.map(row => (
                    <TaskCard key={row.id} row={row} stage="pending" just={justDoneIds.has(row.id)} t={t}
                      onOpen={() => { openSession(row.id) }}
                      onApprove={() => { markDone(row.id, row.displayTitle) }}
                      onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                  ))}
                {/* byClaude-start 派活台账的自动完成汇报组：host 判定完成后落到这里，卡片带总结（byClaude） */}
                {autoDone.length > 0 && (
                  <>
                    <div className="flow-label"><span className="gdot green" aria-hidden="true" />{t('tasks.autoDone')}</div>
                    {autoDone.map(report => {
                      const row = listState.byId[report.sessionId as SessionId]
                      const title = report.title ?? row?.title ?? report.sessionId.slice(0, 8)
                      return (
                        <DoneCard key={report.sessionId} report={report} title={title} just={justDoneIds.has(report.sessionId)} t={t}
                          onOpen={row !== undefined || report.note !== 'session-gone'
                            ? () => { openSession(report.sessionId as SessionId) }
                            : undefined} />
                      )
                    })}
                  </>
                )}
                {/* byClaude-end */}
              </div>
              <div className="done-sum">
                <Icon n="check-check" className="ic sm" />{t('done.sum').replace('{n}', String(board.done.length))}
                {board.done.slice(0, 2).map(row => (
                  <span key={row.id} className="dchip"><Icon n="files" className="ic xs" />{row.displayTitle}</span>
                ))}
              </div>
            </section>
          </div>
          <div className="quick" aria-label={t('quick.title')}>
            {CHIPS.map(({ icon, label, text }) => (
              <button
                key={label}
                type="button"
                className="qchip"
                disabled={reference === undefined || failed}
                onClick={() => { sendText(t(text)) }}
              ><Icon n={icon} className="ic sm" />{t(label)}</button>
            ))}
          </div>
          {interceptBar}
          <AskBox
            disabled={reference === undefined || failed}
            placeholder={t('ask.placeholder')}
            sendLabel={t('ask.send')}
            catalog={modelCatalog}
            selection={modelSelection}
            onSelect={applyModelSelection}
            onSubmit={sendText}
            onFocusChange={setAttentive}
          />
          <div className="statusbar">
            <span className="sti ok"><Icon n="shield-check" />{t('status.local')}</span>
            <span className="sep" aria-hidden="true" />
            <span className="sti"><Icon n="gauge" />{t('stat.watching').replace('{count}', String(watching))}</span>
            <span className="sep" aria-hidden="true" />
            <span className={`sti${board.ongoing.length > 0 ? ' dfy-plug-run' : ''}`}>
              <Icon n="plug" />
              {board.ongoing.length > 0
                ? t('stat.running').replace('{count}', String(board.ongoing.length))
                : t('badge.idle')}
            </span>
          </div>
          </main>
        </section>
      ) : view === 'console' ? (
        <section id="view-console" className="view cs" aria-label={t('view.console')}>
          <main className="cs-main">
            <div
              className={`hero${reference !== undefined ? ' clickable' : ''}${running ? ' running' : ''}`}
              title={reference !== undefined ? t('hero.openChat') : undefined}
              role={reference !== undefined ? 'button' : undefined}
              tabIndex={reference !== undefined ? 0 : undefined}
              aria-label={t('hero.openChat')}
              onClick={reference !== undefined ? openButlerChat : undefined}
              onKeyDown={reference !== undefined
                ? (event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openButlerChat() } })
                : undefined}
            >
              {/* byClaude-start 跑动轨道：running 时鲸鱼娘在 84px 轨道上来回跑（帧动画 + 位移），
                  停下回 breathe 待机呼吸（byClaude） */}
              <div className="hero-orb-track" aria-hidden="true">
                <div className="hero-orb"><ButlerFish size={46} running={running} /></div>
              </div>
              {/* byClaude-end */}
              <div className="hero-mid">
                <div className="hero-label"><Icon n="sparkles" className="ic xs" />{running ? t('hero.thinking') : t('hero.idle')}</div>
                {/* byClaude-start 思考横幅＝状态栏：live 态单行滚动条（思考过程实时尾部），
                    空闲态两行钳制的最新回复；不放全文（全文看下方对话面板）（byClaude） */}
                <div className={`thought${thoughtLive ? ' live' : ''}`}><span className="mono">{thought}</span><span className="caret" aria-hidden="true" /></div>
                {/* byClaude-end */}
              </div>
              {board.ongoing.length > 0 && (
                <div className="hero-timer">
                  <div className="t mono">{timeAgo(board.ongoing.at(0)?.updatedAt ?? Date.now(), t)}</div>
                  <small>{running ? t('hero.runTime') : t('hero.lastActive')}</small>
                </div>
              )}
            </div>
            <div className="cs-body">
              <section className="chat-panel" aria-label={t('panel.chat')}>
                <div
                  className={`panel-h${reference !== undefined ? ' clickable' : ''}`}
                  title={reference !== undefined ? t('hero.openChat') : undefined}
                  onClick={reference !== undefined ? openButlerChat : undefined}
                >
                  <Icon n="message-circle" className="ic sm" />{t('panel.chat')} · {t('butler.name')}</div>
                {msgList}
              </section>
              <section className="flow-panel" aria-label={t('tasks.title')}>
                <div className="panel-h">
                  <Icon n="activity" className="ic sm" />
                  {t('tasks.title').replace(' · ', ' · ')}{t('tasks.count').replace('{n}', String(watching))}
                </div>
                <div className="flow-scroll">
                  {/* byClaude-start 自主意识模块（v3 A 卡，与工作台同款）：控制台是默认
                      视图，主人第一眼就该看到管家自主巡检的死活与新活（byClaude） */}
                  <AutonomyMind status={autonomyStatus} pending={pendingProposals}
                    busy={proposalBusy} onDecision={onProposalDecision}
                    onToggle={onAutonomyToggle} toggleBusy={autonomyBusy} t={t} />
                  <div className="mind-cut" aria-hidden="true" />
                  {/* byClaude-end */}
                  {flowRows.length === 0 && <div className="dfy-empty-row">{t('tasks.empty')}</div>}
                  <ol className="flow">
                    {flowPageRows.map(({ row, stage, report }) => (
                      <FlowStep key={row.id} row={row} stage={stage} report={report} t={t}
                        onOpen={() => { openSession(row.id) }}
                        onApprove={() => { markDone(row.id, row.displayTitle) }}
                        onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                    ))}
                  </ol>
                </div>
                {flowPageCount > 1 && (
                  <div className="flow-pager">
                    <button type="button" className="mini pg"
                      disabled={flowPageIndex === 0}
                      aria-label={t('tasks.page.prev')}
                      onClick={() => { setFlowPage(Math.max(0, flowPageIndex - 1)) }}>{t('tasks.page.prev')}</button>
                    <span className="pg-info mono">
                      {t('tasks.page.info').replace('{p}', String(flowPageIndex + 1)).replace('{n}', String(flowPageCount))}
                    </span>
                    <button type="button" className="mini pg"
                      disabled={flowPageIndex === flowPageCount - 1}
                      aria-label={t('tasks.page.next')}
                      onClick={() => { setFlowPage(Math.min(flowPageCount - 1, flowPageIndex + 1)) }}>{t('tasks.page.next')}</button>
                  </div>
                )}
              </section>
            </div>
            {interceptBar}
            <AskBox
              disabled={reference === undefined || failed}
              placeholder={t('ask.placeholder2')}
              sendLabel={t('ask.send')}
              catalog={modelCatalog}
              selection={modelSelection}
              onSelect={applyModelSelection}
              onSubmit={sendText}
              onFocusChange={setAttentive}
            />
          </main>
        </section>
      ) : (
        /* byClaude-start agent team 聊天室视图：群消息流 + 右侧成员栏 + 输入条（byClaude） */
        <section id="view-team" className="view cs" aria-label={t('view.team')}>
          <main className="cs-main">
            <div className="cs-body team-body">
              <section className="chat-panel team-panel" aria-label={t('view.team')}>
                <div className="panel-h">
                  <Icon n="bot" className="ic sm" />{t('view.team')} · {t('team.members').replace('{n}', String(TEAM_AGENTS.length))}
                </div>
                <div className="msgs team-msgs" ref={teamScrollRef}>
                  {teamLog.length === 0 && <div className="dfy-empty-row">{t('team.empty')}</div>}
                  {teamLog.map(message => message.from === 'me'
                    ? (
                      <div className="msg user" key={message.id}>
                        <div className="ava" aria-hidden="true">
                          {userAvatar !== null ? <img className="dfy-user-avatar" src={userAvatar} alt="" /> : '我'}
                        </div>
                        <div className="bubble">{message.text}</div>
                      </div>
                    )
                    : (() => {
                      const agent = teamAgentOf(message.from)
                      return (
                        <div className="msg ai tm" key={message.id}
                          style={{ '--tm-hue': agent?.hue ?? '#0e7490' } as React.CSSProperties}>
                          <div className="ava" aria-hidden="true">{agent?.emoji ?? '🐟'}</div>
                          <div className="tm-col">
                            <div className="tm-name">{agent?.name ?? message.from}</div>
                            {message.pending === true
                              ? <div className="bubble"><span className="stream">{t('team.thinking')}</span></div>
                              : message.error === true
                                ? <div className="bubble tm-err">{message.text !== '' ? message.text : t('team.error.send')}</div>
                                : (
                                  <div className="bubble md">
                                    <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{message.text}</Markdown>
                                  </div>
                                )}
                          </div>
                        </div>
                      )
                    })())}
                </div>
              </section>
              {/* 右侧成员栏：头像 + 分工一句话 + 在想状态点；点击即 @。 */}
              <aside className="team-side" aria-label={t('team.roster')}>
                <div className="panel-h"><Icon n="at-sign" className="ic sm" />{t('team.roster')}</div>
                <div className="team-side-scroll">
                  {TEAM_AGENTS.map(agent => {
                    const busy = teamLog.some(row => row.from === agent.id && row.pending === true)
                    return (
                      <div key={agent.id} className={`tmb-cell${teamOverrides[agent.id] !== undefined ? ' edited' : ''}`}>
                        <button type="button" className={`tmb${busy ? ' busy' : ''}`}
                          title={agent.tagline} onClick={() => { onRosterPick(agent) }}>
                          <span className="tmb-ava" aria-hidden="true">{agent.emoji}</span>
                          <span className="tmb-mid">
                            <span className="tmb-name">{agent.name}</span>
                            <span className="tmb-tag">{agent.tagline}</span>
                          </span>
                          {busy && <span className="tmb-dot" aria-label={t('team.thinking')} />}
                        </button>
                        <button type="button" className="tmb-edit" title={t('team.edit')}
                          aria-label={`${t('team.edit')}: ${agent.name}`} onClick={() => { openAgentEditor(agent) }}>
                          <Icon n="settings" className="ic xs" />
                        </button>
                      </div>
                    )
                  })}
                  <span className="tmb-hint">{t('team.hint')}</span>
                </div>
              </aside>
            </div>
            {interceptBar}
            <AskBox
              disabled={false}
              placeholder={t('team.placeholder')}
              sendLabel={t('ask.send')}
              catalog={null}
              selection={null}
              onSelect={noopModelSelect}
              onSubmit={sendTeam}
              onFocusChange={setAttentive}
              insert={teamInsert}
            />
          </main>
        </section>
      /* byClaude-end */
      )}

      {/* byClaude-start 成员编辑浮层：人格与能力 / 挂载技能（本地覆盖，派发时优先注入）（byClaude） */}
      {editingAgent !== null && (
        <div className="dfy-agent-editor" role="dialog" aria-modal="true" aria-label={`${t('team.edit')} · ${editingAgent.name}`}>
          <div className="ae-card">
            <div className="ae-head">
              <span className="ae-title"><span aria-hidden="true">{editingAgent.emoji}</span>{t('team.edit')} · {editingAgent.name}</span>
              <button type="button" className="ae-close" aria-label={t('chat.detail.close')} onClick={() => { setEditingAgent(null) }}>×</button>
            </div>
            <label className="ae-field">
              <span className="ae-label">{t('team.edit.persona')}<em className="ae-hint">{t('team.edit.personaHint')}</em></span>
              <textarea value={draftPersona} rows={9}
                onChange={event => { setDraftPersona(event.target.value) }} />
            </label>
            <div className="ae-field">
              <span className="ae-label">{t('team.edit.skills')}</span>
              {skillOptions !== null && skillOptions.length > 0 ? (
                <div className="ae-skills" role="group">
                  {skillOptions.map(skill => {
                    const on = draftSkillList.includes(skill.name)
                    return (
                      <button key={skill.name} type="button" className={`ae-skill${on ? ' on' : ''}`}
                        title={skill.description ?? skill.name}
                        aria-pressed={on} onClick={() => { toggleSkill(skill.name) }}>
                        {skill.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <textarea value={draftSkills} rows={2}
                  placeholder={skillOptions === null ? t('team.edit.skillsPh') : t('team.edit.skillsEmpty')}
                  onChange={event => { setDraftSkills(event.target.value) }} />
              )}
            </div>
            <div className="ae-acts">
              <button type="button" className="ae-btn primary" onClick={saveAgentOverride}>{t('team.edit.save')}</button>
              <button type="button" className="ae-btn" onClick={resetAgentOverride}>{t('team.edit.reset')}</button>
              <button type="button" className="ae-btn" onClick={() => { setEditingAgent(null) }}>{t('team.edit.cancel')}</button>
            </div>
          </div>
        </div>
      )}
      {/* byClaude-end */}

      {/* 右下角轻通知 */}
      <div className="dfy-toasts" aria-live="polite">
        {toasts.map(item => <div key={item.id} className="dfy-toast">{item.text}</div>)}
      </div>

      {/* 官方完整对话浮层：面板内全铺开，Esc 收起。 */}
      {detailOpen && (
        <div className="dfy-detail" role="dialog" aria-label={t('chat.detail')}>
          <div className="dfy-detail-head">
            <span>{t('panel.chat')} · {t('butler.name')}</span>
            <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--faint)' }}>Esc {t('chat.detail.close')}</span>
            <button ref={closeBtnRef} type="button" className="dfy-detail-close" onClick={() => { setDetailOpen(false) }}>
              {t('chat.detail.close')} ∨
            </button>
          </div>
          {chat}
        </div>
      )}
    </div>
  )
}
// byClaude-end

// Contains claude-generated edits.
