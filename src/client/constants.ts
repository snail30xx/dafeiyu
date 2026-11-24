/**
 * 大肥鱼管家的常量：会话标题与管家之家工作区标题（client 半侧共用）。
 * byClaude
 */
// byClaude-start
/** 管家会话的可读标题（会话列表里认出这条管家线）。 */
export const BUTLER_TITLE = '大肥鱼管家'

/** 管家之家工作区标题：host 半侧启动时在 ~/.dafeiyu/home 注册，管家会话只住这里。 */
export const BUTLER_HOME_TITLE = '大肥鱼之家'

/**
 * 判定是否管家之家目录：按路径后缀（~/.dafeiyu/home），不依赖标题——
 * 标题可被改动，路径才是稳定身份（斜杠与大小写做规范化）。
 */
export function isButlerHomePath(path: string): boolean {
  return path.replaceAll('\\', '/').toLowerCase().endsWith('/.dafeiyu/home')
}
// byClaude-end

// byClaude-start IM（钉钉机器人）配置标记：host 半侧读到 ~/.dafeiyu/im.json（webhook 合法）
// 即注册 ~/.dafeiyu/im 标记工作区；面板以它的存在判定「已配置 IM」（byClaude）
/** IM 标记工作区标题（host 注册用；面板按路径判定，不看标题）。 */
export const IM_HOME_TITLE = '大肥鱼·IM'

/** 判定是否 IM 标记工作区目录（~/.dafeiyu/im，斜杠与大小写规范化）。 */
export function isImHomePath(path: string): boolean {
  return path.replaceAll('\\', '/').toLowerCase().endsWith('/.dafeiyu/im')
}
// byClaude-end

// byClaude-start agent team 聊天室：成员定义与目录约定（byClaude）
/** 团队成员会话标题统一前缀：任务看板与侧边栏按此隐身。 */
export const TEAM_SESSION_PREFIX = '肥鱼团队·'

/** team 工作区根：~/.dafeiyu/team/<agentId>/，每成员一个（AGENTS.md 播种角色）。 */
export const TEAM_HOME_ROOT = '.dafeiyu/team'

/** 判定是否 team 成员目录（~/.dafeiyu/team/<id>，不含根本身）。 */
export function isTeamHomePath(path: string): boolean {
  const norm = path.replaceAll('\\', '/').toLowerCase()
  const at = norm.indexOf('/' + TEAM_HOME_ROOT + '/')
  return at !== -1 && at + TEAM_HOME_ROOT.length + 2 < norm.length
}

/**
 * 团队成员（聊天室第三视图）：每成员 = 独立工作区 + 独立会话（上下文互不串）；
 * 群聊上下文由派发时拼接（共享窗口上下文）。emoji 充当头像，hue 是主题色。
 * persona 文本在 host 半侧 persona.ts（不进 client bundle）。
 */
export interface TeamAgentDef {
  readonly id: string
  readonly name: string
  readonly emoji: string
  readonly hue: string
  /** 一句话角色（成员条 tooltip / @ 提示）。 */
  readonly tagline: string
}

export const TEAM_AGENTS: readonly TeamAgentDef[] = [
  { id: 'fish', name: '肥鱼', emoji: '🐟', hue: '#0e7490', tagline: '调度管家 · 默认接话' },
  { id: 'coder', name: '码仔', emoji: '💻', hue: '#7c3aed', tagline: '写代码 · 改文件 · 跑测试' },
  { id: 'reviewer', name: '评审', emoji: '🧐', hue: '#db2777', tagline: '代码 review · 按证据提意见' },
  { id: 'tester', name: '测仔', emoji: '🧪', hue: '#4f46e5', tagline: '测试设计 · 自测 · 回归验证' },
  { id: 'designer', name: '画师', emoji: '🎨', hue: '#c026d3', tagline: 'UI 视觉设计 · 配色与布局' },
  { id: 'pixel', name: '像素', emoji: '📏', hue: '#0284c7', tagline: 'UI 还原审计 · 像素级比对' },
  { id: 'scout', name: '罗盘', emoji: '🧭', hue: '#65a30d', tagline: '产品调研 · 需求与竞品' },
  { id: 'sleuth', name: '探长', emoji: '🔍', hue: '#d97706', tagline: '查日志 · 看监控 · 排故障' },
  { id: 'scribe', name: '笔杆', emoji: '📝', hue: '#059669', tagline: '写文档 · 记知识 · 画表格' },
]

/** 默认接话成员：无 @ 时发给谁。 */
export const TEAM_DEFAULT_AGENT = 'fish'

/** 会话标题（找会话 / 新建后改名用）。 */
export function teamSessionTitle(agentId: string): string {
  const agent = TEAM_AGENTS.find(row => row.id === agentId)
  return TEAM_SESSION_PREFIX + (agent?.name ?? agentId)
}
// byClaude-end

// byClaude-start 派活台账（自动总结与汇报）：host 半侧落盘、/api/dafeiyu/tasks
// 端点与面板共用的对外快照行。纯数据形状，host/client 两侧都能安全 import（byClaude）
/** 派活台账条目状态：active = 已派出待完成；waiting-input = 等主人交互（批准/答题）；done = 已判定完成。 */
export type TaskReportStatus = 'active' | 'waiting-input' | 'done'

/** 完成但拿不到正常总结时的原因注记。 */
export type TaskReportNote = 'session-gone' | 'no-output'

/** 一条派活记录的对外投影（host 台账 → 面板任务卡）。 */
export interface TaskReport {
  readonly sessionId: string
  /** 任务摘要：派活文本截断（恢复上下文用，不是完成总结）。 */
  readonly task: string
  /** 派活时的会话标题（可缺省，面板回退会话列表标题）。 */
  readonly title?: string
  readonly status: TaskReportStatus
  readonly dispatchedAt: number
  /** waiting-input 时等的是什么（宿主 pendingInput 首项）。 */
  readonly pendingKind?: 'approval' | 'question' | 'other'
  /** 判定完成的时刻（done 必有）。 */
  readonly completedAt?: number
  /** 完成总结：最后一轮 assistant 回复的结论段抽取。 */
  readonly summary?: string
  /** 无总结的原因注记（summary 缺席时面板展示它）。 */
  readonly note?: TaskReportNote
}
// byClaude-end

// byClaude-start 管家自主性（眼里有活）：巡检发现的新活先落提议台账，主人批准才派活。
// host 半侧 proposals.ts 落盘、/api/dafeiyu/proposals 端点与面板提议卡共用（byClaude）
/** 提议状态：pending = 待主人裁决；approved = 已批准（派活成功后转 dispatched）；ignored = 主人忽略。 */
export type ProposalStatus = 'pending' | 'approved' | 'ignored' | 'dispatched'

/** 一条管家提议的对外投影（host 台账 → 面板提议卡）。 */
export interface ProposalReport {
  /** 稳定 ID：kind + 外部键（如 ones:vos:<uuid>），同一条活只提议一次。 */
  readonly id: string
  /** 提议种类：目前只有 ONES 新需求；后续可扩展巡检器。 */
  readonly kind: 'ones-requirement'
  /** 一行标题（需求标题等）。 */
  readonly title: string
  /** 补充说明（状态 / 编号 / uuid 等，面板副行与钉钉推送用）。 */
  readonly detail: string
  readonly createdAt: number
  readonly status: ProposalStatus
  /** 主人裁决时刻（approved/ignored/dispatched 必有）。 */
  readonly decidedAt?: number
  /** dispatched 后关联的执行会话（面板可跳转）。 */
  readonly sessionId?: string
}

/** 提议数据面的一次快照：台账列表 + 自主循环心跳（同一 GET 响应带出）。 */
export interface ProposalsSnapshot {
  readonly list: readonly ProposalReport[]
  readonly autonomy?: AutonomyStatus
}

/** 提议裁决结果：ok:false 时 message 是端点回传的真实原因（每日上限/派活失败等）。 */
export type ProposalDecision =
  | { readonly ok: true; readonly proposal: ProposalReport | null }
  | { readonly ok: false; readonly message: string }

/** 自主性总开关切换结果：ok:true 附最新心跳（面板就地更新 A 卡）。 */
export type AutonomyToggleResult =
  | { readonly ok: true; readonly autonomy?: AutonomyStatus }
  | { readonly ok: false; readonly message: string }
// byClaude-end

// byClaude-start 自主循环心跳（可观测性）：host 侧 autonomy.ts 每轮巡检（成功与失败）
// 都写 ~/.dafeiyu/autonomy-status.json，/api/dafeiyu/proposals GET 附带带给面板——
// 「没活」与「死了」一眼可辨（空转的循环此前零落盘，桌面宿主也不持久化日志）（byClaude）
/** 单项目巡检状态：最近成功时刻 / 窗口条数 / 最近失败摘要（成功后清除）。 */
export interface AutonomyProjectStatus {
  readonly lastOkAt?: number
  readonly itemCount?: number
  readonly lastError?: string
}

/** 自主循环心跳快照（host 写、面板读；字段全部可选容错，坏文件按缺省处理）。 */
export interface AutonomyStatus {
  /** 巡检总开关（autonomy.json ones.enabled）。 */
  readonly enabled: boolean
  /** 本宿主生命周期内循环启动时刻。 */
  readonly startedAt: number
  /** 最近一轮巡检（含失败）时刻。 */
  readonly lastScoutAt?: number
  /** 下一轮预计时刻（lastScoutAt + interval，近似值）。 */
  readonly nextScoutAt?: number
  readonly intervalMinutes: number
  /** 当前是否处于静音时段（只静推送不静巡检）。 */
  readonly inQuietHours: boolean
  readonly dailyDispatchLimit: number
  readonly dailyDispatched: number
  /** 最近一次成功推送用的通道（dsh-im 出站或 im.json webhook）；从未推过则缺席。 */
  readonly pushChannel?: 'dsh-im' | 'webhook'
  readonly projects: Readonly<Record<string, AutonomyProjectStatus>>
}
// byClaude-end

// Contains claude-generated edits.
