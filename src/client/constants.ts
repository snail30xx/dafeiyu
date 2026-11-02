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

// Contains claude-generated edits.
