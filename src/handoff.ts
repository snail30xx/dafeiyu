/**
 * fatfish_session_handoff：把当前对话移交到一个携带完整上下文前缀的新对话。
 * 实现即宿主官方 fork：复制截至最近完成轮次（或指定 atSeq）的全部事件到新会话。
 * byClaude
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'

const HANDOFF_ERROR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const HANDOFF_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sourceSessionId: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    boundarySeq: { type: 'integer', required: true },
    summary: { type: 'string' },
    note: { type: 'string', required: true },
  },
} as const

/** 注册 handoff 工具。 */
export function registerHandoffTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'fatfish_session_handoff',
    description:
      'Hand the current conversation off to a NEW session that carries the full context up to the latest '
      + 'completed turn (or an explicit atSeq event boundary). Use it when the context is getting long, when '
      + 'switching to a new task phase, or when the user asks to move on cleanly: the new session replays '
      + 'everything that happened so far. summary should capture what to do next in the new session. '
      + 'The current session stays untouched. Tell the user the new session title/id so they can open it.',
    parameters: {
      summary: { type: 'string', required: true, description: 'What has happened and what to do next in the new session' },
      atSeq: { type: 'integer', description: 'Optional inclusive event boundary to fork from (default: latest completed turn)' },
    },
    output: {
      schema: { oneOf: [HANDOFF_VIEW, HANDOFF_ERROR] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        return { code: 'no_session', message: 'this tool must run inside a session' }
      }
      try {
        const forked = await ctx.sessionController.fork({
          sessionId: agent.id,
          ...(args.atSeq === undefined ? {} : { atSeq: args.atSeq }),
        })
        return {
          sourceSessionId: agent.id,
          sessionId: forked.sessionId,
          boundarySeq: args.atSeq ?? -1,
          summary: args.summary,
          note:
            'New session created with the full event prefix of the source conversation. '
            + 'Open it from the sidebar (its title starts with the source title). The source session is unchanged.',
        }
      } catch (error) {
        return {
          code: 'handoff_failed',
          message: `failed to hand off session: ${String(error)}`,
        }
      }
    },
  }))
}
