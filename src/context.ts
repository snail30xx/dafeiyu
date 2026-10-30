/**
 * fatfish_context_status / fatfish_context_compact：当前对话的上下文体检与手动压缩。
 * byClaude
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-compaction'

const STATUS_ERROR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const STATUS_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    events: { type: 'integer', required: true },
    userMessages: { type: 'integer', required: true },
    toolCalls: { type: 'integer', required: true },
    turns: { type: 'integer', required: true },
    compactionRegions: { type: 'integer', required: true },
    lastEventSeq: { type: 'integer', required: true },
    advice: { type: 'string', required: true },
  },
} as const

const COMPACT_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    compacted: { type: 'boolean', required: true },
    summarySeq: { type: 'integer' },
    shadowedEvents: { type: 'integer' },
    detail: { type: 'string', required: true },
  },
} as const

function render(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const ERROR_VIEW = (code: string, message: string): { code: string, message: string } => ({ code, message })

/** 注册上下文体检工具（无条件）。 */
export function registerContextTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'fatfish_context_status',
    description:
      'Report the context load of the current session: event count, user messages, tool calls, turns, and how many '
      + 'compaction regions already summarize older history. Use it when deciding whether to compact or hand off.',
    parameters: {},
    output: { schema: { oneOf: [STATUS_VIEW, STATUS_ERROR] }, render },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) return ERROR_VIEW('no_session', 'this tool must run inside a session')
      try {
        const events = agent.session.snapshotEvents()
        let userMessages = 0
        let toolCalls = 0
        let turns = 0
        let compactionRegions = 0
        for (const event of events) {
          if (event.type === 'user/message') userMessages += 1
          else if (event.type === 'tool/call') toolCalls += 1
          else if (event.type === 'turn/end') turns += 1
          else if (event.type === 'compaction/start') compactionRegions += 1
        }
        const lastEventSeq = events.at(-1)?.seq ?? -1
        const advice = compactionRegions > 0
          ? 'older history is already compacted; hand off (fatfish_session_handoff) when the session feels heavy'
          : toolCalls > 80 || userMessages > 30
            ? 'context is getting long: consider fatfish_context_compact or fatfish_session_handoff'
            : 'context is in a normal range'
        return {
          sessionId: agent.id,
          events: events.length,
          userMessages,
          toolCalls,
          turns,
          compactionRegions,
          lastEventSeq,
          advice,
        }
      } catch (error) {
        return ERROR_VIEW('status_failed', `failed to inspect session context: ${String(error)}`)
      }
    },
  }))

}

/** 注册手动压缩工具（仅在 compaction 服务可用的部署中注册）。
 * @returns 注销该工具的 disposer。 */
export function registerCompactTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'fatfish_context_compact',
    description:
      'Compact the current session NOW: summarize older history into one compaction summary and shadow the '
      + 'original events, freeing context window space. Runs only when the session is idle; returns '
      + 'compacted=false when compaction is unnecessary or unavailable.',
    parameters: {},
    output: { schema: { oneOf: [COMPACT_VIEW, STATUS_ERROR] }, render },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) return ERROR_VIEW('no_session', 'this tool must run inside a session')
      try {
        const result = await ctx.compaction.compactNow(agent, exec.signal)
        if (result === null) {
          return {
            sessionId: agent.id,
            compacted: false,
            detail: 'compaction engine decided no compaction is needed right now',
          }
        }
        const shadowedEvents = result.shadowedRange === undefined
          ? undefined
          : result.shadowedRange.end - result.shadowedRange.start + 1
        return {
          sessionId: agent.id,
          compacted: true,
          summarySeq: result.summarySeq,
          ...(shadowedEvents === undefined ? {} : { shadowedEvents }),
          detail: 'older history summarized; the summary now stands in for the shadowed events',
        }
      } catch (error) {
        return ERROR_VIEW('compact_failed', `failed to compact session: ${String(error)}`)
      }
    },
  }))
}
