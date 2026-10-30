/**
 * fatfish_session_* 对话（Session）管理工具：列出、新建、重命名、归档/恢复、置顶、派活。
 * byClaude
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import { isButlerHomePath } from './client/constants.js'

const SESSION_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    title: { type: 'string' },
    cwd: { type: 'string' },
    updatedAt: { type: 'integer', required: true },
    running: { type: 'boolean', required: true },
    blank: { type: 'boolean', required: true },
    archived: { type: 'boolean' },
  },
} as const

const SESSION_ERROR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const OK_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    done: { type: 'boolean', required: true },
  },
} as const

// byClaude-start 派活结果视图：目标会话、是否本次新建、任务是否已排队（byClaude）
const DISPATCH_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    created: { type: 'boolean', required: true },
    queued: { type: 'boolean', required: true },
  },
} as const

/** SessionRequestId 是纯 branded string（无运行时构造导出），UUID 直接断言即可。 */
const mintRequestId = (raw: string): SessionRequestId => raw as SessionRequestId
// byClaude-end

function render(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const ERROR_VIEW = (code: string, message: string): { code: string, message: string } => ({ code, message })

/** 会话标题投影值键；dsh 的 SessionSummary.projections.values.title。 */
interface ProjectionValues {
  readonly title?: string
  readonly sessionListMetadata?: { title?: string }
}

/** 读取会话摘要的显示标题（投影里没有时回退空）。 */
function titleOf(summary: { readonly projections?: { readonly values?: unknown } }): string {
  const values = summary.projections?.values as Partial<ProjectionValues> | undefined
  const direct = values?.title ?? values?.sessionListMetadata?.title
  return direct ?? ''
}

/** 注册对话工具。 */
export function registerSessionTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'fatfish_session_list',
    description:
      'List sessions (conversations). Optional workspaceId filters to one workspace; '
      + 'optional query matches title or content. Each item carries sessionId, title, cwd, updatedAt, running, blank.',
    parameters: {
      workspaceId: { type: 'string', description: 'Only sessions attached to this workspace' },
      query: { type: 'string', description: 'Optional text match over session content' },
      limit: { type: 'integer', description: 'Max items to return (default 50)' },
    },
    output: {
      schema: { oneOf: [{ type: 'array', items: SESSION_VIEW }, SESSION_ERROR] },
      render,
    },
    async execute(args, exec) {
      try {
        let sessionIdFilter: ReadonlySet<string> | undefined
        if (args.workspaceId !== undefined) {
          const workspace = ctx.workspaceRegistry.list()
            .find(item => item.id === args.workspaceId || item.path === args.workspaceId)
          if (workspace === undefined) {
            return ERROR_VIEW('workspace_not_found', `workspace "${args.workspaceId}" not found`)
          }
          sessionIdFilter = new Set(workspace.sessionIds)
        }
        let items
        if (args.query !== undefined && args.query.trim().length > 0) {
          const found = await ctx.sessionController.search({ query: args.query }, exec.signal)
          const allowed = found.items
            .filter(item => sessionIdFilter === undefined || sessionIdFilter.has(item.sessionId))
            .map(item => item.sessionId)
          const listed = await ctx.sessionController.list({}, exec.signal)
          items = listed.items
            .filter(summary => allowed.includes(summary.sessionId))
            .map(summary => ({ ...summary, title: titleOf(summary) }))
        } else {
          const listed = await ctx.sessionController.list({}, exec.signal)
          items = listed.items
            .filter(summary => sessionIdFilter === undefined || sessionIdFilter.has(summary.sessionId))
            .map(summary => ({ ...summary, title: titleOf(summary) }))
        }
        const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
        const limit = args.limit ?? 50
        return items
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, limit)
          .map(summary => ({
            sessionId: summary.sessionId,
            title: titleOf(summary),
            cwd: summary.cwd ?? '',
            updatedAt: summary.updatedAt,
            running: summary.running,
            blank: summary.blank,
            archived: archived.has(summary.sessionId),
          }))
      } catch (error) {
        return ERROR_VIEW('list_failed', `failed to list sessions: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_session_create',
    description:
      'Create a new session (conversation). Pass workspaceId to open it inside a project, or cwd for a '
      + 'standalone directory session; with neither, the session uses the harness default directory.',
    parameters: {
      workspaceId: { type: 'string', description: 'Workspace the new session joins' },
      cwd: { type: 'string', description: 'Standalone directory (mutually exclusive with workspaceId)' },
      agentPreset: { type: 'string', description: 'Optional agent preset id for the new session' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              sessionId: { type: 'string', required: true },
              agentPreset: { type: 'string' },
            },
          },
          SESSION_ERROR,
        ],
      },
      render,
    },
    async execute(args) {
      if (args.workspaceId !== undefined && args.cwd !== undefined) {
        return ERROR_VIEW('bad_request', 'pass workspaceId or cwd, not both')
      }
      // 管家之家只住管家会话：UI 侧已把它整个隐身（dafeiyu homeFilter），
      // 这里挡住工具面，防止在它里面开出用户看不见的对话。
      if (args.cwd !== undefined && isButlerHomePath(args.cwd)) {
        return ERROR_VIEW('butler_home_forbidden', 'butler home (~/.dafeiyu/home) only hosts the butler session')
      }
      if (args.workspaceId !== undefined) {
        const home = ctx.workspaceRegistry.list()
          .find(item => (item.id === args.workspaceId || item.path === args.workspaceId)
            && isButlerHomePath(item.path))
        if (home !== undefined) {
          return ERROR_VIEW('butler_home_forbidden', 'butler home (~/.dafeiyu/home) only hosts the butler session')
        }
      }
      try {
        const created = await ctx.sessionController.create({
          ...(args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId as never }),
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.agentPreset === undefined ? {} : { agentPreset: args.agentPreset }),
        })
        return { sessionId: created.sessionId, ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }) }
      } catch (error) {
        return ERROR_VIEW('create_failed', `failed to create session: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_session_rename',
    description: 'Rename a session (conversation) by sessionId.',
    parameters: {
      sessionId: { type: 'string', required: true },
      title: { type: 'string', required: true, description: 'New title' },
    },
    output: { schema: { oneOf: [OK_VIEW, SESSION_ERROR] }, render },
    async execute(args) {
      try {
        const accepted = await ctx.sessionController.rename({
          sessionId: SessionId(args.sessionId),
          title: args.title,
        })
        return { sessionId: args.sessionId, done: true, ...(accepted === undefined ? {} : {}) }
      } catch (error) {
        return ERROR_VIEW('rename_failed', `failed to rename session: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_session_archive',
    description:
      'Archive a session (the product deletion semantics: hidden from lists, history kept). '
      + 'stopActivity=true first stops a running turn, then archives.',
    parameters: {
      sessionId: { type: 'string', required: true },
      stopActivity: { type: 'boolean', description: 'Stop a live turn before archiving (default false)' },
    },
    output: { schema: { oneOf: [OK_VIEW, SESSION_ERROR] }, render },
    async execute(args) {
      try {
        await ctx.workspaceController.archiveSession({
          sessionId: SessionId(args.sessionId),
          ...(args.stopActivity === undefined ? {} : { stopActivity: args.stopActivity }),
        })
        return { sessionId: args.sessionId, done: true }
      } catch (error) {
        return ERROR_VIEW('archive_failed', `failed to archive session: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_session_unarchive',
    description: 'Restore an archived session back to the workspace list.',
    parameters: { sessionId: { type: 'string', required: true } },
    output: { schema: { oneOf: [OK_VIEW, SESSION_ERROR] }, render },
    async execute(args) {
      try {
        await ctx.workspaceController.unarchiveSession({ sessionId: SessionId(args.sessionId) })
        return { sessionId: args.sessionId, done: true }
      } catch (error) {
        return ERROR_VIEW('unarchive_failed', `failed to unarchive session: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_session_pin',
    description: 'Pin or unpin a session in its workspace. pin=false unpins.',
    parameters: {
      sessionId: { type: 'string', required: true },
      pin: { type: 'boolean', required: true },
    },
    output: { schema: { oneOf: [OK_VIEW, SESSION_ERROR] }, render },
    async execute(args) {
      try {
        if (args.pin) await ctx.workspaceController.pinSession({ sessionId: SessionId(args.sessionId) })
        else await ctx.workspaceController.unpinSession({ sessionId: SessionId(args.sessionId) })
        return { sessionId: args.sessionId, done: true }
      } catch (error) {
        return ERROR_VIEW('pin_failed', `failed to pin/unpin session: ${String(error)}`)
      }
    },
  }))

  // byClaude-start 派活：管家调度员的核心动作——复用已有会话或新建会话，并把任务排进队列（byClaude）
  ctx.tools.register(defineTool({
    name: 'fatfish_session_dispatch',
    description:
      'Dispatch a task to a worker session and queue it as a prompt. Pass sessionId to REUSE an existing session '
      + '(preferred when a matching one exists — check fatfish_session_list first); omit sessionId to CREATE a new '
      + 'session (inside workspaceId, or standalone cwd, or the harness default directory) and queue the task as its '
      + 'first prompt. text must be self-contained (the target session knows nothing about this conversation). '
      + 'Returns the target sessionId; tell the user which session now owns the task.',
    parameters: {
      text: { type: 'string', required: true, description: 'Self-contained task description for the target session' },
      sessionId: { type: 'string', description: 'Reuse this existing session (preferred when one matches)' },
      workspaceId: { type: 'string', description: 'Create the new session inside this workspace' },
      cwd: { type: 'string', description: 'Create a standalone session in this directory (mutually exclusive with workspaceId)' },
      title: { type: 'string', description: 'Optional title when creating a new session' },
    },
    output: { schema: { oneOf: [DISPATCH_VIEW, SESSION_ERROR] }, render },
    async execute(args, exec) {
      if (args.sessionId !== undefined && (args.workspaceId !== undefined || args.cwd !== undefined)) {
        return ERROR_VIEW('bad_request', 'pass either sessionId (reuse) or workspaceId/cwd (create), not both')
      }
      if (args.workspaceId !== undefined && args.cwd !== undefined) {
        return ERROR_VIEW('bad_request', 'pass workspaceId or cwd, not both')
      }
      if (args.text.trim().length === 0) {
        return ERROR_VIEW('bad_request', 'text must be a non-empty task description')
      }
      // 管家不派活给自己，会形成自指循环。
      if (exec.agent !== undefined && args.sessionId === exec.agent.id) {
        return ERROR_VIEW('self_dispatch_forbidden', 'the butler does not dispatch tasks to itself')
      }
      let target = args.sessionId
      let created = false
      try {
        if (target === undefined) {
          // 与 fatfish_session_create 同款守卫：管家之家不开工作会话。
          if (args.cwd !== undefined && isButlerHomePath(args.cwd)) {
            return ERROR_VIEW('butler_home_forbidden', 'butler home (~/.dafeiyu/home) only hosts the butler session')
          }
          if (args.workspaceId !== undefined) {
            const home = ctx.workspaceRegistry.list()
              .find(item => (item.id === args.workspaceId || item.path === args.workspaceId)
                && isButlerHomePath(item.path))
            if (home !== undefined) {
              return ERROR_VIEW('butler_home_forbidden', 'butler home (~/.dafeiyu/home) only hosts the butler session')
            }
          }
          const made = await ctx.sessionController.create({
            ...(args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId as never }),
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          })
          target = made.sessionId
          created = true
          if (args.title !== undefined && args.title.trim().length > 0) {
            await ctx.sessionController.rename({ sessionId: SessionId(target), title: args.title }).catch(() => undefined)
          }
        }
        await ctx.sessionController.prompt({
          requestId: mintRequestId(crypto.randomUUID()),
          sessionId: SessionId(target),
          mode: 'queue',
          content: [{ type: 'text', text: args.text }],
        }, exec.signal)
        return { sessionId: target, created, queued: true }
      } catch (error) {
        return ERROR_VIEW('dispatch_failed', `failed to dispatch task: ${String(error)}`)
      }
    },
  }))
  // byClaude-end
}
