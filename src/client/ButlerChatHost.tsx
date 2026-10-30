/**
 * 管家面板内嵌的官方对话宿主：在 SessionProvider（管家会话）作用域内渲染官方
 * conversation.content（embedded 变体）——composer（模型选择/附件/命令菜单）与
 * 消息流全部为官方原生渲染。默认态由外层 CSS 只露出 composer，详细态完整展示。
 * byClaude
 */
// byClaude-start
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** 本槽 props：runtime 注入的会话源 + factory 渲染能力。 */
export type ButlerChatHostProps = PropsRuntime<'dafeiyu.butler.chat'>
  & PropsRenderFactories

/**
 * 渲染官方 conversation.content，phase/hero 按管家会话状态推导
 * （参照 ui-subagent 的 ConversationSlotPanel）。
 * @param props - 会话源与 renderFactorySlot。
 * @returns 官方对话内容（embedded）。
 */
export function ButlerChatHost({
  sessionId, useSession, renderFactorySlot,
}: ButlerChatHostProps) {
  const session = useSession(value => value)
  if (sessionId === undefined) return null
  const active = (!session.blank && !session.awaitingFirstTurn) || session.running === true
  const hero = !active && !session.promptAttempted && session.openState === 'open'
  // 官方 conversation.content 的 phase 只有三种：engaging 等中间态最终落 active
  // （对照 ui-subagent ConversationSlotPanel 的 phase 归一）。
  const phase = session.openState === 'loading' ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    // 不选 views：使用官方默认（对话/轨迹等视图集合）。
  })
}
// byClaude-end

// Contains claude-generated edits.
