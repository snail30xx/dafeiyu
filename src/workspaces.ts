/**
 * fatfish_workspace_* 项目（Workspace）管理工具：列出、新建、重命名、移除注册。
 * byClaude
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-workspace'

const WORKSPACE_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workspaceId: { type: 'string', required: true },
    path: { type: 'string', required: true },
    title: { type: 'string', required: true },
    sessionCount: { type: 'integer', required: true },
  },
} as const

const WORKSPACE_ERROR = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const ERROR_VIEW = (code: string, message: string): { code: string, message: string } => ({ code, message })

/** 统一渲染：规范值直接转模型可见 JSON 文本。 */
function render(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** 管家之家目录判定：rename/remove 不得动管家的家（斜杠与大小写规范化）。 */
function isButlerHomePath(path: string): boolean {
  return path.replaceAll('\\', '/').toLowerCase().endsWith('/.dafeiyu/home')
}

/** 注册项目工具。 */
export function registerWorkspaceTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'fatfish_workspace_list',
    description:
      'List all workspaces (projects) registered in DeepSeek Harness. '
      + 'Each item carries workspaceId, path, title, and the number of sessions in the workspace.',
    parameters: {},
    output: {
      schema: { oneOf: [{ type: 'array', items: WORKSPACE_VIEW }, WORKSPACE_ERROR] },
      render,
    },
    async execute() {
      const items = ctx.workspaceRegistry.list().map(workspace => ({
        workspaceId: workspace.id,
        path: workspace.path,
        title: workspace.title,
        sessionCount: workspace.sessionIds.length,
      }))
      return items
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_workspace_create',
    description:
      'Register an existing directory as a new workspace (project). The path must be an absolute directory path. '
      + 'Registration never creates or modifies files on disk. Returns the new workspaceId. '
      + 'Idempotent: registering an already-registered path returns the existing workspace.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute directory path of the project' },
      title: { type: 'string', description: 'Optional display title; defaults to the directory name' },
    },
    output: {
      schema: { oneOf: [WORKSPACE_VIEW, WORKSPACE_ERROR] },
      render,
    },
    async execute(args) {
      if (args.path.trim().length === 0) return ERROR_VIEW('invalid_path', 'path must be a non-empty absolute path')
      try {
        const workspace = await ctx.workspaceRegistry.create(
          args.path,
          args.title === undefined ? undefined : args.title,
        )
        return {
          workspaceId: workspace.id,
          path: workspace.path,
          title: workspace.title,
          sessionCount: workspace.sessionIds.length,
        }
      } catch (error) {
        return ERROR_VIEW('create_failed', `failed to create workspace: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_workspace_rename',
    description: 'Rename a workspace (project) by workspaceId.',
    parameters: {
      workspaceId: { type: 'string', required: true, description: 'Target workspace id' },
      title: { type: 'string', required: true, description: 'New display title' },
    },
    output: {
      schema: { oneOf: [WORKSPACE_VIEW, WORKSPACE_ERROR] },
      render,
    },
    async execute(args) {
      try {
        const target = ctx.workspaceRegistry.list().find(ws => ws.id === args.workspaceId)
        if (target !== undefined && isButlerHomePath(target.path)) {
          return ERROR_VIEW('butler_home_protected', 'the butler home workspace cannot be renamed')
        }
        const value = await ctx.workspaceController.rename({
          workspaceId: WorkspaceId(args.workspaceId),
          title: args.title,
        })
        const row = value.workspace
        return {
          workspaceId: row.workspaceId,
          path: row.path,
          title: row.title,
          sessionCount: row.sessionIds.length,
        }
      } catch (error) {
        return ERROR_VIEW('rename_failed', `failed to rename workspace: ${String(error)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_workspace_remove',
    description:
      'Remove a workspace registration. This only detaches the project from the sidebar: '
      + 'no files and no sessions are deleted. Sessions keep their history and stay reachable.',
    parameters: {
      workspaceId: { type: 'string', required: true, description: 'Workspace id to remove' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              workspaceId: { type: 'string', required: true },
              removed: { type: 'boolean', required: true },
            },
          },
          WORKSPACE_ERROR,
        ],
      },
      render,
    },
    async execute(args) {
      try {
        const target = ctx.workspaceRegistry.list().find(ws => ws.id === args.workspaceId)
        if (target !== undefined && isButlerHomePath(target.path)) {
          return ERROR_VIEW('butler_home_protected', 'the butler home workspace cannot be removed')
        }
        const removed = await ctx.workspaceRegistry.delete(WorkspaceId(args.workspaceId))
        return { workspaceId: args.workspaceId, removed }
      } catch (error) {
        return ERROR_VIEW('remove_failed', `failed to remove workspace: ${String(error)}`)
      }
    },
  }))
}
