/**
 * 大肥鱼 IM（钉钉机器人）配置检测：host 半侧判定「是否已配置 IM」，
 * 并把该事实同步成标记工作区（~/.dafeiyu/im）——dsh 没有 host→client 的
 * 插件数据通道（remote 命名空间由 Client 装配固定生成），工作区目录是
 * 现有唯一可观察面：与管家之家/团队工作区同机制，面板用 rawWorkspaceSnapshot
 * 检测该标记（homeFilter 负责对侧边栏隐身）。
 *
 * 检测口径（任一命中即视为已配置）：
 * 1. dsh-im 插件的连接配置真值：$DSH_HOME/sdb/application.sqlite 的
 *    im_connection_settings 表行数 > 0（本机已核实 provider=dws 的 1 行）。
 *    机器人 Client Secret 与 Pull Access Token 只写 Host 本地 SQLite，这是权威状态。
 * 2. 兜底约定文件 ~/.dafeiyu/im.json（webhook 为合法 https 才算）。
 *
 * 取舍说明（为什么不走同进程服务发现）：dsh-im 在宿主内 ctx.provide('im', service)，
 * 但其服务面 snapshot() 只暴露 bots/pull/messages（经 #assertActive 门禁，
 * 加载时序与生命周期都不稳），并不包含「连接是否已配置」——连接配置的真值只在
 * SQLite 的 im_connection_settings 表里。因此这里用 node:sqlite 只读打开该库
 * 直查计数：无写入、无服务耦合，打开失败/表不存在/任何异常一律回退「未配置」，
 * 不影响宿主启动（busy 场景由 dsh-im 自己的 busy_timeout 连接兜底，互不干扰）。
 * byClaude
 */
// byClaude-start
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { IM_HOME_TITLE } from './client/constants.js'

/** 兜底约定文件 im.json 的内容：webhook 必填（钉钉机器人回调地址），secret 可选（加签密钥）。 */
export interface ImConfig {
  readonly webhook: string
  readonly secret?: string | undefined
}

/** 判定是否 IM 标记工作区目录（~/.dafeiyu/im，斜杠与大小写规范化）。 */
function isImHomePathHost(path: string): boolean {
  return path.replaceAll('\\', '/').toLowerCase().endsWith('/.dafeiyu/im')
}

/** dsh-im 业务库路径：$DSH_HOME/sdb/application.sqlite（DSH_HOME 缺省回退 ~/.dsh）。 */
function dshImDatabasePath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'sdb', 'application.sqlite')
}

/**
 * 只读探测 dsh-im 连接配置表：im_connection_settings 行数 > 0 即已配置。
 * 只读连接、查完即关；文件不存在 / 库被锁 / 表不存在等任何异常一律 false。
 */
function dshImConnectionConfigured(): boolean {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(dshImDatabasePath(), { readOnly: true })
    const row = database.prepare('SELECT COUNT(*) AS n FROM im_connection_settings')
      .get() as { readonly n?: number | bigint } | undefined
    return Number(row?.n ?? 0) > 0
  } catch {
    return false
  } finally {
    try { database?.close() } catch { /* 只读连接关闭失败可忽略 */ }
  }
}

/**
 * 兜底：读取并校验 ~/.dafeiyu/im.json——文件不存在 / 坏 JSON / webhook 非空 https
 * 一律视为未配置（null）。
 */
export async function readImConfig(): Promise<ImConfig | null> {
  try {
    const raw = await readFile(join(homedir(), '.dafeiyu', 'im.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const webhook = record.webhook
    if (typeof webhook !== 'string' || !/^https:\/\/\S+$/.test(webhook.trim())) return null
    const secret = record.secret
    return {
      webhook: webhook.trim(),
      secret: typeof secret === 'string' && secret.trim() !== '' ? secret.trim() : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 「是否已配置 IM」总判定：dsh-im 连接配置表（权威）→ im.json 兜底，任一命中即 true。
 */
export async function detectImConfigured(): Promise<boolean> {
  if (dshImConnectionConfigured()) return true
  return await readImConfig() !== null
}

/**
 * 把「已配置 IM」同步成标记工作区：已配置注册（幂等，同路径返回已有工作区），
 * 未配置摘除旧注册（registry.delete 只解绑不删盘，与 fatfish_workspace_remove 同语义）。
 * @param ctx - 宿主上下文（workspaceRegistry）。
 * @param configured - detectImConfigured 的结果。
 */
export async function syncImMarkerWorkspace(ctx: Context, configured: boolean): Promise<void> {
  if (!configured) {
    const stale = ctx.workspaceRegistry.list().find(ws => isImHomePathHost(ws.path))
    if (stale !== undefined) await ctx.workspaceRegistry.delete(WorkspaceId(stale.id))
    return
  }
  const dir = join(homedir(), '.dafeiyu', 'im')
  await mkdir(dir, { recursive: true })
  await ctx.workspaceRegistry.create(dir, IM_HOME_TITLE)
}

// byClaude-start IM 勾选框的 host 端点：dsh-im 的通用通道 RPC 在 web 壳没有 HTTP 载体
// （connection.rpc 的 fetch 面挂在根路径，CLI 0.2.1 webserver 只服务 /api），因此走
// connection 的共享 API 通道精确路由：注册 /api/dafeiyu/im，owner 会话直调同宿主的
// dsh-im 服务（快照 / 开关机器人）。连接或 dsh-im 缺席时回调不触发，端点与勾选框
// 一并安静退场（面板置灰）（byClaude）
/** dsh-im 服务面里本端点用到的最小结构（dafeiyu 不依赖其包，结构对齐 ImService）。 */
interface ImServiceLike {
  snapshot(): { readonly bots: readonly unknown[] }
  toggleBot(request: { readonly version: 1; readonly botId: number; readonly expectedRevision: number; readonly enabled: boolean }): Promise<void>
}

/** 面板关心的 bot 最小字段（结构对齐 dsh-im 契约 ImBotView）。 */
interface ImBotRow {
  readonly id: number
  readonly name: string
  readonly enabled: boolean
  readonly listenerStatus: unknown
  readonly lastError?: unknown
  readonly revision: number
}

/** 从任意 bot 行剥出合法最小字段；形状不对的行跳过。 */
function imBotRow(bot: unknown): ImBotRow | undefined {
  if (bot === null || typeof bot !== 'object') return undefined
  const row = bot as Partial<ImBotRow>
  if (typeof row.id !== 'number' || typeof row.name !== 'string' || typeof row.enabled !== 'boolean'
    || typeof row.revision !== 'number' || typeof row.listenerStatus !== 'string') return undefined
  const status = row.listenerStatus
  if (status !== 'stopped' && status !== 'starting' && status !== 'running' && status !== 'error') return undefined
  return { id: row.id, name: row.name, enabled: row.enabled, listenerStatus: status, revision: row.revision,
    ...(typeof row.lastError === 'string' ? { lastError: row.lastError } : {}) }
}

/**
 * 注册 /api/dafeiyu/im 精确路由（POST，buffered）：{action:'snapshot'} 读快照、
 * {action:'toggle', botId, expectedRevision, enabled} 开关机器人。
 * @param ctx - 宿主上下文（connection + im 双服务就绪后生效）。
 */
export function registerImEndpoint(ctx: Context): void {
  ctx.inject(['connection', 'im'], scoped => {
    const connection = (scoped as unknown as {
      readonly connection?: {
        readonly fetch?: { readonly register?: (route: unknown) => Promise<() => Promise<void>> }
      }
    }).connection
    const im = (scoped as unknown as { readonly im?: ImServiceLike }).im
    const register = connection?.fetch?.register
    if (typeof register !== 'function' || im === undefined) return
    const route = {
      // 路由键是含 /api 前缀的完整路径（fetchRoutes 按请求 pathname 精确匹配，
      // endpointFromPath("/api", path) 校验要求 path 以 /api/ 开头）。
      path: '/api/dafeiyu/im',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        try {
          const body: unknown = await request.json()
          const record = body === null || typeof body !== 'object' ? undefined : body as Record<string, unknown>
          if (record?.action === 'toggle') {
            const botId = record.botId
            const expectedRevision = record.expectedRevision
            const enabled = record.enabled
            if (typeof botId !== 'number' || typeof expectedRevision !== 'number' || typeof enabled !== 'boolean') {
              return Response.json({ ok: false, message: 'invalid toggle request' }, { status: 400 })
            }
            await im.toggleBot({ version: 1, botId, expectedRevision, enabled })
          } else if (record?.action !== 'snapshot') {
            return Response.json({ ok: false, message: 'unknown action' }, { status: 400 })
          }
          const bots = im.snapshot().bots.map(imBotRow).filter((row): row is ImBotRow => row !== undefined)
          return Response.json({ ok: true, bots })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ ok: false, message }, { status: 500 })
        }
      },
    }
    void register(route).then(dispose => {
      scoped.effect(() => () => { void dispose() }, 'dafeiyu: im endpoint route')
    }, (error: unknown) => {
      scoped.logger.warn('dafeiyu: im endpoint route rejected: %o', error)
    })
  })
}
// byClaude-end
// byClaude-end
