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

// Contains claude-generated edits.
