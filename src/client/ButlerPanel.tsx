/**
 * 大肥鱼管家面板 v10：按交互稿 dafayu-prototype.html 1:1 还原。
 * 结构与类名全部对齐设计稿：极光三团 + 视图切换（工作台/控制台）+
 * 工作台（greet-row / v1-work：work-chat[work-stage 3D 立绘舞台 + msgs 消息流] +
 * work-tasks[flow-scroll 任务卡 + done-sum] / quick 快捷指令 / ask-box 自绘输入条 /
 * statusbar）+ 控制台（hero 思考横幅 + cs-body：chat-panel + flow-panel 大步骤时间线）。
 * CSS 与 SVG symbol 由 boardCss.ts / boardDefs.ts 从设计稿全量迁移（scoped 到 .dfy-root）。
 * 数据全部真实：消息流 = 管家会话事件摘要；任务卡 = 会话目录看板；输入条直排会话队列。
 * 官方 composer 完整对话保留为 detail 浮层（「完整对话」按钮进入，Esc 收起）。
 * byClaude
 */
// byClaude-start
// byClaude-start
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { BUTLER_TITLE, isButlerHomePath } from './constants.js'
import { BOARD_CSS } from './boardCss.js'
import { SVG_DEFS } from './boardDefs.js'
import type { DafeiyuKey } from './locales.js'

/** 管家会话 face / 事件流的快照值类型（从 SessionReference 结构推导）。 */
type SessionFaceState = SessionReference['binding']['session'] extends ObservableSnapshot<infer S> ? S : never
type SessionEventsState = SessionReference['binding']['eventSource'] extends ObservableSnapshot<infer W> ? W : never

/** 注入面板的动作面与数据源。 */
export interface ButlerInjected {
  readonly hooks: {
    /** 会话目录快照：三态看板的数据源（框架转成 useSessionList 钩子）。 */
    readonly sessionList: ObservableSnapshot<SessionListState>
    /** 工作区列表快照：取全局归档集与管家之家路径，看板不展示已归档/管家会话。 */
    readonly workspaceList: ObservableSnapshot<WorkspaceSnapshot>
  }
  /** 取得管家会话引用：找不到就新建并改名，返回已 retain 的引用（面板负责 release）。 */
  readonly acquire: () => Promise<SessionReference>
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
/** 迷你聊天总结最多展示的消息条数（user + butler + 流式行合计）。 */
const DIGEST_ROWS = 6

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

/** 空总结的模块级常量：useSyncExternalStore 的 getSnapshot 必须返回稳定引用。 */
const EMPTY_DIGEST: readonly ChatDigestRow[] = []
/** revision → 摘要行缓存：同一快照 revision 期间复用同一数组引用，防无限重渲染。 */
const digestCache = new WeakMap<object, { revision: number; rows: readonly ChatDigestRow[] }>()

// byClaude-start 摘要截断：按整行截而不是按字符截，保护 Markdown 结构（byClaude）
/** 单条摘要的字符预算：超出按行边界截断（迷你流可滚动，无需狠截）。 */
const DIGEST_TEXT_CAP = 480
/** 截断省略标记预留。 */
const DIGEST_TEXT_TAIL = 24

/**
 * 单条摘要截断：超过预算保留前若干完整行 + 省略号。
 * 必须按整行截：拦腰截半行会把粗体/列表项/代码块截成残缺 Markdown，渲染就烂了；
 * 截断点若停在未闭合的代码围栏（``` 奇数次），补一个闭合围栏防止代码块吞掉结尾。
 */
function digestText(text: string): string {
  if (text.length <= DIGEST_TEXT_CAP) return text
  const lines = text.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > DIGEST_TEXT_CAP - DIGEST_TEXT_TAIL) break
    kept.push(line)
    used += line.length + 1
  }
  let out = kept.join('\n').trimEnd()
  const fences = out.split(/^`{3}/m).length - 1
  if (fences % 2 === 1) out += '\n```'
  return `${out}\n…`
}
// byClaude-end

/** 从事件窗收最近的真人消息摘要与流式管家输出（新消息在后）。 */
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
    rows.push({ seq: liveSeq, role: 'butler', text: digestText(liveText), time: liveTime, streaming: true })
  }

  // durable 消息：user 只认真人输入（source.kind === 'user'）——运行时上下文、
  // system-reminder 等工具注入也走 user/message 事件，混进摘要就全是噪音。
  for (; index >= 0 && rows.length < DIGEST_ROWS; index--) {
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
      text: digestText(text),
      time: entry.event.time ?? 0,
    })
  }
  const rowsView: readonly ChatDigestRow[] = rows.reverse()
  digestCache.set(window as object, { revision, rows: rowsView })
  return rowsView
}

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
 */
function MsgList({ rows, running, thinking, t, digestRef, userAvatar }: {
  rows: readonly ChatDigestRow[]
  running: boolean
  /** 无流式行但会话在跑：追加「正在想…」占位行。 */
  thinking: string
  t: (key: DafeiyuKey) => string
  digestRef: { readonly current: HTMLDivElement | null }
  /** 登录用户头像 URL；null 时用户消息头像退回「我」字。 */
  userAvatar: string | null
}) {
  return (
    <div className="msgs" ref={digestRef} role="log" aria-live="polite" aria-label={t('panel.chat')}>
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
function FlowStep({ row, stage, onOpen, onApprove, onReject, t }: {
  row: SessionSummary
  stage: 'ongoing' | 'pending' | 'done'
  onOpen: () => void
  onApprove: () => void
  onReject: () => void
  t: (key: DafeiyuKey) => string
}) {
  const live = stage === 'ongoing'
  const wait = stage === 'pending'
  const project = cwdName(row.cwd)
  const icon = live ? undefined : wait ? 'power' : 'check'
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
          <span className="s-tag">{live ? t('board.running') : wait ? t('stage.pending') : t('stage.done')}</span>
          <span className="mono">{timeAgo(row.updatedAt, t)}</span>
        </div>
        <p className="s-p">{project !== '' ? project : row.displayTitle}</p>
        {live && <div className="s-bar indet" role="progressbar" aria-label={row.displayTitle}><i /></div>}
        {wait && (
          <div className="s-acts">
            <button type="button" className="mini ok" onClick={event => { event.stopPropagation(); onApprove() }}><Icon n="check" className="ic xs" />{t('board.approve')}</button>
            <button type="button" className="mini no" onClick={event => { event.stopPropagation(); onReject() }}><Icon n="x" className="ic xs" />{t('board.reject')}</button>
          </div>
        )}
      </div>
    </li>
  )
}

// byClaude-start
/** 自绘输入条（设计稿 .ask-box）：Enter 直排管家会话队列；工具行 = 模型选择 + 思考深度 + 发送。 */
function AskBox({ disabled, placeholder, sendLabel, catalog, selection, onSelect, onSubmit, onFocusChange }: {
  disabled: boolean
  placeholder: string
  sendLabel: string
  catalog: ModelCatalogLike | null
  selection: ModelSelectionLike | null
  onSelect: (next: ModelSelectionLike) => void
  onSubmit: (text: string) => void
  onFocusChange: (attentive: boolean) => void
}) {
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<'model' | 'effort' | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const boxRef = useRef<HTMLFormElement | null>(null)
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
  useSessionList, useWorkspaceList, acquire, openSession, models, t, renderSlot, SessionProvider,
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
  const [detailOpen, setDetailOpen] = useState(false)
  const [view, setView] = useState<'workbench' | 'console'>('console')
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

  // 新消息/流式增量落地后消息流滚到底部。
  useEffect(() => {
    const node = digestRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [digest])

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
  const board = useMemo(() => {
    const butlerId = reference?.sessionId
    const archived = new Set(workspaceState.archivedSessionIds)
    // 管家之家整个工作区与管家标题的旧会话都不进看板：看板只看用户的活。
    const rows = listState.ids
      .map(id => listState.byId[id])
      .filter((row): row is SessionSummary =>
        row !== undefined && !row.blank && row.origin !== 'subagent'
        && row.id !== butlerId && !archived.has(row.id)
        && !isButlerHomePath(row.cwd ?? '') && row.title !== BUTLER_TITLE)
    const byRecent = (left: SessionSummary, right: SessionSummary) => right.updatedAt - left.updatedAt
    // 被忽略的会话从看板整个消失（不算完成，也不进任何分组）。
    const visible = rows.filter(row => ignoreMap[row.id] === undefined)
    const ongoing = visible.filter(row => row.running).sort(byRecent)
    const pending = visible.filter(row =>
      !row.running && doneMap[row.id] === undefined && Date.now() - row.updatedAt < PENDING_WINDOW_MS)
      .sort(byRecent)
    const done = visible
      .filter(row => !ongoing.includes(row) && !pending.includes(row))
      .sort(byRecent)
      .slice(0, DONE_LIST_CAP)
    return { ongoing, pending, done }
  }, [listState, workspaceState, doneMap, ignoreMap, reference?.sessionId])

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
  // 控制台思考横幅：最新一条管家输出（含流式）；没话说就亮状态文案。
  let thought = t('cap.idle')
  for (const row of digest) if (row.role === 'butler') thought = row.text

  const chat = reference !== undefined
    ? <SessionProvider session={reference}>{renderSlot('dafeiyu.butler.chat', {})}</SessionProvider>
    : null

  const moodDot = mood === 'work' ? 'dfy-dot-run' : mood === 'listen' ? 'dfy-dot-listen' : 'dot-ok'
  const moodText = mood === 'work' ? t('badge.thinking') : mood === 'listen' ? t('badge.listening') : t('badge.idle')

  const msgList = (
    <MsgList
      rows={failed ? [] : digest}
      running={running}
      thinking={t('butler.thinking')}
      t={t}
      digestRef={digestRef}
      userAvatar={userAvatar}
    />
  )

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
        </nav>
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
                <div className="flow-label"><span className="gdot cyan" aria-hidden="true" />{t('stage.ongoing')}</div>
                {board.ongoing.length === 0
                  ? <div className="dfy-empty-row">{t('board.empty.ongoing')}</div>
                  : board.ongoing.map(row => (
                    <TaskCard key={row.id} row={row} stage="ongoing" just={justDoneIds.has(row.id)} t={t}
                      onOpen={() => { openSession(row.id) }}
                      onApprove={() => { markDone(row.id, row.displayTitle) }}
                      onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                  ))}
                <div className="flow-label"><span className="gdot amber" aria-hidden="true" />{t('stage.pending')}</div>
                {board.pending.length === 0
                  ? <div className="dfy-empty-row">{t('board.empty.pending')}</div>
                  : board.pending.map(row => (
                    <TaskCard key={row.id} row={row} stage="pending" just={justDoneIds.has(row.id)} t={t}
                      onOpen={() => { openSession(row.id) }}
                      onApprove={() => { markDone(row.id, row.displayTitle) }}
                      onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                  ))}
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
      ) : (
        <section id="view-console" className="view cs" aria-label={t('view.console')}>
          <main className="cs-main">
            <div
              className={`hero${reference !== undefined ? ' clickable' : ''}`}
              title={reference !== undefined ? t('hero.openChat') : undefined}
              role={reference !== undefined ? 'button' : undefined}
              tabIndex={reference !== undefined ? 0 : undefined}
              aria-label={t('hero.openChat')}
              onClick={reference !== undefined ? openButlerChat : undefined}
              onKeyDown={reference !== undefined
                ? (event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openButlerChat() } })
                : undefined}
            >
              <div className="hero-orb" aria-hidden="true"><ButlerFish size={46} running={running} /></div>
              <div className="hero-mid">
                <div className="hero-label"><Icon n="sparkles" className="ic xs" />{running ? t('hero.thinking') : t('hero.idle')}</div>
                <div className="thought"><span className="mono">{thought}</span><span className="caret" aria-hidden="true" /></div>
              </div>
              <div className="hero-timer">
                <div className="t mono">{timeAgo(board.ongoing.at(0)?.updatedAt ?? Date.now(), t)}</div>
                <small>{running ? t('hero.runTime') : t('hero.lastActive')}</small>
              </div>
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
                  <ol className="flow">
                    {board.ongoing.map(row => (
                      <FlowStep key={row.id} row={row} stage="ongoing" t={t}
                        onOpen={() => { openSession(row.id) }}
                        onApprove={() => { markDone(row.id, row.displayTitle) }}
                        onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                    ))}
                    {board.pending.map(row => (
                      <FlowStep key={row.id} row={row} stage="pending" t={t}
                        onOpen={() => { openSession(row.id) }}
                        onApprove={() => { markDone(row.id, row.displayTitle) }}
                        onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                    ))}
                    {board.done.map(row => (
                      <FlowStep key={row.id} row={row} stage="done" t={t}
                        onOpen={() => { openSession(row.id) }}
                        onApprove={() => { markDone(row.id, row.displayTitle) }}
                        onReject={() => { ignoreSession(row.id, row.displayTitle) }} />
                    ))}
                  </ol>
                </div>
              </section>
            </div>
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
      )}

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
