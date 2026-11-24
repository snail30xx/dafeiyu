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
 * 2. 兜底约定文件 ~/.dafeiyu/im.json（webhook 合法 https，或带 dsh-im 推送目标
 *    botId/conversationId 任一）。
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
import { createHmac } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { IM_HOME_TITLE, type TaskReport } from './client/constants.js'

/**
 * 兜底约定文件 im.json 的内容：钉钉推送目标，两组字段二选一——
 * webhook（自定义机器人回调地址，secret 可选加签）或 dsh-im 出站目标
 * （botId + conversationId；conversationId 为群 openConversationId（cid 开头）
 * 或员工 userid（机器人单聊））。全缺省时 dsh-im 通道自动探测目标（见
 * resolveImPushTarget），webhook 兜底不可用。
 */
export interface ImConfig {
  readonly webhook?: string | undefined
  readonly secret?: string | undefined
  readonly botId?: number | undefined
  readonly conversationId?: string | undefined
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
 * 兜底：读取并校验 ~/.dafeiyu/im.json——文件不存在 / 坏 JSON / 一个合法字段都
 * 没有（webhook 非空 https、botId 正整数、conversationId 非空字符串）一律视为
 * 未配置（null）。
 */
export async function readImConfig(): Promise<ImConfig | null> {
  try {
    const raw = await readFile(join(homedir(), '.dafeiyu', 'im.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const webhook = typeof record.webhook === 'string' && /^https:\/\/\S+$/.test(record.webhook.trim())
      ? record.webhook.trim() : undefined
    const secret = typeof record.secret === 'string' && record.secret.trim() !== '' ? record.secret.trim() : undefined
    const botId = typeof record.botId === 'number' && Number.isInteger(record.botId) && record.botId > 0
      ? record.botId : undefined
    const conversationId = typeof record.conversationId === 'string' && record.conversationId.trim() !== ''
      ? record.conversationId.trim() : undefined
    if (webhook === undefined && botId === undefined && conversationId === undefined) return null
    return {
      ...(webhook !== undefined ? { webhook } : {}),
      ...(webhook !== undefined && secret !== undefined ? { secret } : {}),
      ...(botId !== undefined ? { botId } : {}),
      ...(conversationId !== undefined ? { conversationId } : {}),
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

// byClaude-start IM 真推送：首选同宿主 dsh-im 出站（钉钉 Stream 机器人，多行文本
// 自动转 markdown 卡片、首行作卡片标题），未绑定/失败回退 im.json webhook
// （secret 加签 = HmacSHA256(timestamp + "\n" + secret) 的 base64 随 URL 参数上送）。
// dsh-im 端口绑定是 ctx.inject 动态依赖：服务缺席/卸载时端口置空、恢复自动续绑
// （与 yolo-agent work-order-report 同款范式），推送绝不抛错影响宿主流程（byClaude）
/** dsh-im 出站推送端口：bindImPush 绑定，im 服务卸载时置空（缺席回退 webhook）。 */
let imPushPort: ((text: string) => Promise<void>) | undefined

/** 最近一次成功推送使用的通道；从未推过则 undefined（autonomy 心跳展示用）。 */
let lastPushChannel: 'dsh-im' | 'webhook' | undefined

/** 心跳读：最近一次成功推送走的通道。 */
export function imPushChannel(): 'dsh-im' | 'webhook' | undefined {
  return lastPushChannel
}

/**
 * 绑定 dsh-im 出站推送端口（index.ts 装配时调用一次）：im 服务就绪时置端口、
 * 卸载时置空；老宿主服务面没有 send 时不绑定（推送走 webhook 兜底）。
 */
export function bindImPush(ctx: Context): void {
  ctx.inject(['im'], scoped => {
    const im = (scoped as unknown as { readonly im?: ImServiceLike }).im
    if (im === undefined || typeof im.send !== 'function') return
    imPushPort = async (text: string) => {
      const target = await resolveImPushTarget(im)
      await im.send({ version: 1, botId: target.botId, conversationId: target.conversationId, text })
    }
    scoped.effect(() => () => { imPushPort = undefined }, 'dafeiyu: im push port unbind')
  })
}

/**
 * 解析 dsh-im 出站目标：im.json 显式 botId/conversationId 优先；缺省自动探测
 * ——第一个启用机器人 + 最近一条入站消息的会话。管家机器人单人使用，最近会话
 * 即主人；多人共用机器人时请在 im.json 显式指定 conversationId。
 * 解析不出目标时抛错（pushDingtalk 捕获后回退 webhook）。
 */
async function resolveImPushTarget(im: ImServiceLike): Promise<{ botId: number; conversationId: string }> {
  const config = await readImConfig()
  const snapshot = im.snapshot()
  const botId = config?.botId
    ?? snapshot.bots.map(imBotRow).find(row => row !== undefined && row.enabled)?.id
  if (botId === undefined) throw new Error('dsh-im 无启用机器人（可在 im.json 指定 botId）')
  const conversationId = config?.conversationId ?? latestInboundConversation(snapshot.messages ?? [])
  if (conversationId === undefined) throw new Error('dsh-im 无可推送会话（可在 im.json 指定 conversationId）')
  return { botId, conversationId }
}

/** 从快照消息里找最近入站会话（倒序首条 inbound；无入站回退任意消息的会话）。 */
function latestInboundConversation(messages: readonly unknown[]): string | undefined {
  let fallback: string | undefined
  for (const row of [...messages].reverse()) {
    const message = row as Partial<{ readonly direction: unknown; readonly conversationId: unknown }> | null
    if (message === null || typeof message.conversationId !== 'string' || message.conversationId === '') continue
    if (fallback === undefined) fallback = message.conversationId
    if (message.direction === 'inbound') return message.conversationId
  }
  return fallback
}

/**
 * 钉钉消息推送（签名不变）：首选 dsh-im 出站，未绑定/失败回退 im.json webhook；
 * 两条路都不通（未配置/网络失败/errcode 非 0）返回 false，调用方自行降级（落日志）。
 */
export async function pushDingtalk(title: string, text: string): Promise<boolean> {
  if (imPushPort !== undefined) {
    try {
      await imPushPort(text)
      lastPushChannel = 'dsh-im'
      return true
    } catch (error) {
      console.warn('[dafeiyu] dsh-im push failed, falling back to webhook:',
        error instanceof Error ? error.message : error)
    }
  }
  const config = await readImConfig()
  if (config?.webhook === undefined) return false
  let url = config.webhook
  if (config.secret !== undefined) {
    const timestamp = Date.now()
    const sign = createHmac('sha256', config.secret).update(`${timestamp}\n${config.secret}`).digest('base64')
    url += `&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  if (response === undefined || !response.ok) return false
  const data: unknown = await response.json().catch(() => undefined)
  const ok = typeof data === 'object' && data !== null
    && (data as { readonly errcode?: unknown }).errcode === 0
  if (ok) lastPushChannel = 'webhook'
  return ok
}

/**
 * 任务完成的 IM（钉钉）推送入口：标题取会话标题（缺省回退任务摘要截断），
 * 正文取完成总结或原因注记；推送失败（未配置/网络/errcode）落宿主日志。
 * @param report - 完成收案后的台账投影（含总结或原因注记）。
 */
export async function notifyTaskComplete(report: TaskReport): Promise<void> {
  const title = report.title ?? report.task.slice(0, 40)
  const noteText = report.note === 'session-gone' ? '（会话已归档或删除）'
    : report.note === 'no-output' ? '（任务未产出即结束）' : '已完成'
  const body = report.summary ?? noteText
  const ok = await pushDingtalk(`任务完成：${title}`, `**[大肥鱼] 任务完成**\n\n**${title}**\n\n${body}`)
  if (!ok) console.log(`[dafeiyu] task done (IM push unavailable): ${report.sessionId} ${report.summary ?? report.note ?? ''}`)
}
// byClaude-end

// byClaude-start IM 勾选框的 host 端点：dsh-im 的通用通道 RPC 在 web 壳没有 HTTP 载体
// （connection.rpc 的 fetch 面挂在根路径，CLI 0.2.1 webserver 只服务 /api），因此走
// connection 的共享 API 通道精确路由：注册 /api/dafeiyu/im，owner 会话直调同宿主的
// dsh-im 服务（快照 / 开关机器人）。连接或 dsh-im 缺席时回调不触发，端点与勾选框
// 一并安静退场（面板置灰）（byClaude）
/** dsh-im 服务面里本插件用到的最小结构（dafeiyu 不依赖其包，结构对齐 ImService）。 */
interface ImServiceLike {
  snapshot(): { readonly bots: readonly unknown[]; readonly messages?: readonly unknown[] }
  toggleBot(request: { readonly version: 1; readonly botId: number; readonly expectedRevision: number; readonly enabled: boolean }): Promise<void>
  send(request: { readonly version: 1; readonly botId: number; readonly conversationId: string; readonly text: string }): Promise<unknown>
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
