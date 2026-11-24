/**
 * 运维工单的手（host 半侧）：把 yolo-agent（D:\workspace\yolo-agent，独立 DSH
 * web 服务，默认 127.0.0.1:9081）的「执行器触发 + 执行结果查询」包装成
 * fatfish_* 助手工具——主人在管家聊天里一句话交代工单处理，大肥鱼直调
 * yolo-agent 的 HTTP 端点，不经 LLM 中转，确定性动作。
 *
 * ── 契约（yolo 侧 src/host/resource/dafeiyu-rpc.ts 同步实现）──────────
 * POST {baseUrl}/dafeiyu-bridge/execute  {messageId}  → 人工审核确认并派发
 *   执行（等价 yolo 面板的「执行确认」按钮：按消息定位决策 → 定案 → 派发执行图）。
 * GET  {baseUrl}/dafeiyu-bridge/result?messageId=…     → 该消息的决策与执行
 *   结果投影（决策结论 / 执行记录 / 状态）。
 * 前缀刻意不在 /api 下：DSH 宿主对 /api/* 有全局 owner 鉴权层，工具调用不带
 * 面板凭证会被 401；/dafeiyu-bridge 由 yolo 端点自己的双闸守门。
 * 鉴权：请求头 x-dafeiyu-token 与 yolo 侧 YOLO_DAFEIYU_TOKEN 比对；
 * 未配置 token 时仅允许环回来源（yolo 端点同时校验 remoteAddress 环回）。
 *
 * ── 配置（~/.dafeiyu/yolo.json，坏文件/缺失按默认）────────────────────
 * { "baseUrl": "", "token": "" }
 * baseUrl 解析优先级：
 * 1. 显式 http(s) URL → 直连该地址（yolo 独立部署形态，如 http://127.0.0.1:9081）；
 * 2. 空/缺省（默认）→ 自动探测同宿主 webServer（dsh-yolo-agent 桌面插件形态：
 *    dafeiyu 与 yolo 同一 DSH 宿主进程，端点挂在宿主 webserver 上），
 *    host 为通配地址时折成 127.0.0.1。
 * 保持环回：token 是唯一的跨网防线，不要把 yolo 端点暴露到局域网。
 * byClaude
 */
// byClaude-start
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** yolo.json 内容：baseUrl 空 = 自动探测宿主 webServer（默认），token 可选。 */
interface YoloConfig {
  /** '' = 自动探测同宿主 webServer；显式 http(s) = 直连。 */
  readonly baseUrl: string
  readonly token: string
}

const DEFAULT_CONFIG: YoloConfig = { baseUrl: '', token: '' }

/** 读取 yolo 配置：文件缺失 / 坏 JSON 一律回退默认（baseUrl 空走自动探测）。 */
async function readYoloConfig(): Promise<YoloConfig> {
  try {
    const raw = await readFile(join(homedir(), '.dafeiyu', 'yolo.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_CONFIG
    const record = parsed as Record<string, unknown>
    const baseUrl = typeof record.baseUrl === 'string' && /^https?:\/\/\S+$/.test(record.baseUrl.trim())
      ? record.baseUrl.trim().replace(/\/+$/, '') : DEFAULT_CONFIG.baseUrl
    const token = typeof record.token === 'string' ? record.token : DEFAULT_CONFIG.token
    return { baseUrl, token }
  } catch {
    return DEFAULT_CONFIG
  }
}

/** 宿主 webServer 的最小探测面（同宿主形态的 baseUrl 来源；结构对齐 dsh-host-webserver）。 */
interface WebServerLike {
  readonly host?: string
  readonly port?: number
}

/** 结果视图：ok=false 时 message 必有；payload 透传 yolo 响应 JSON。 */
const YOLO_VIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    message: { type: 'string' },
    payload: { type: 'object', additionalProperties: true },
  },
} as const

function render(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * 统一请求封装：网络失败 / 非 2xx / 业务 ok=false 都折成 {ok:false,message}。
 * payload 是 yolo 响应 JSON 的原样透传（Record<string, never> 只是让结构兼容
 * 工具 schema 推断的 JsonValue 索引签名，运行时形状以 yolo 契约为准）。
 * baseUrl 为 undefined（自动探测失败）时直接返回不可达提示，不发请求。
 */
async function callYolo(
  config: { readonly baseUrl: string | undefined, readonly token: string },
  path: string,
  init: { readonly method: 'GET' | 'POST', readonly body?: string },
): Promise<{ ok: boolean, message?: string, payload?: Record<string, never> }> {
  if (config.baseUrl === undefined || config.baseUrl === '') {
    return { ok: false, message: 'yolo baseUrl unavailable: host webServer not ready and no explicit baseUrl in ~/.dafeiyu/yolo.json' }
  }
  const headers: Record<string, string> = { 'x-dafeiyu-token': config.token }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: init.method,
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
  if (response instanceof Error) {
    return { ok: false, message: `yolo-agent unreachable (${response.message}); is it running on ${config.baseUrl}?` }
  }
  const data: unknown = await response.json().catch(() => undefined)
  const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : undefined
  if (!response.ok) {
    return { ok: false, message: typeof record?.message === 'string' ? record.message : `HTTP ${response.status}` }
  }
  if (record === undefined) return { ok: false, message: 'yolo-agent returned non-JSON body' }
  if (record.ok === false) {
    return { ok: false, message: typeof record.message === 'string' ? record.message : 'yolo-agent rejected the request' }
  }
  const payload = typeof record.result === 'object' && record.result !== null ? record.result : record
  return { ok: true, payload: payload as Record<string, never> }
}

/**
 * 注册 fatfish_yolo_execute / fatfish_yolo_result。
 * messageId 是 yolo-agent 消息体系里的工单消息 ID（面板消息列表可见），
 * 两个工具都以它为锚；yolo 服务缺席时工具调用返回明确的不可达提示。
 */
export function registerYoloTools(ctx: Context): void {
  // 同宿主形态（dsh-yolo-agent 桌面插件）：宿主 webServer 就绪后记下地址，
  // 作 baseUrl 为空时的自动探测来源；webServer 缺席（非 web 组合）保持 undefined。
  let webServerUrl: string | undefined
  ctx.inject(['webServer'], scoped => {
    const webServer = (scoped as unknown as { readonly webServer?: WebServerLike }).webServer
    const { host, port } = webServer ?? {}
    if (typeof host !== 'string' || typeof port !== 'number') return
    // 通配绑定折成环回：host 侧 fetch 需要具体地址。
    const bindHost = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host
    webServerUrl = `http://${bindHost}:${port}`
  })
  /** baseUrl 解析：显式配置优先，空 = 宿主 webServer 探测结果（可能 undefined）。 */
  const resolveBaseUrl = (configured: string): string | undefined =>
    configured !== '' ? configured : webServerUrl

  ctx.tools.register(defineTool({
    name: 'fatfish_yolo_execute',
    description:
      'Trigger the yolo-agent work-order executor for one message: confirms the human-reviewed decision and '
      + 'dispatches the execution graph (same action as the "confirm execution" button in the yolo panel). '
      + 'Use it when the user asks to process/handle a work order (运维工单). The messageId comes from the '
      + 'yolo-agent message list; if unknown, ask the user or check fatfish_yolo_result first.',
    parameters: {
      messageId: { type: 'string', required: true, description: 'yolo-agent message id of the work order' },
    },
    output: { schema: YOLO_VIEW, render },
    async execute(args) {
      const config = await readYoloConfig()
      return await callYolo({ token: config.token, baseUrl: resolveBaseUrl(config.baseUrl) }, '/dafeiyu-bridge/execute', {
        method: 'POST',
        body: JSON.stringify({ messageId: args.messageId }),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fatfish_yolo_result',
    description:
      'Query the yolo-agent work-order execution result for one message: the decision outcome and the latest '
      + 'execution record (channel, status, detail). Safe to call repeatedly while an execution is in flight.',
    parameters: {
      messageId: { type: 'string', required: true, description: 'yolo-agent message id of the work order' },
    },
    output: { schema: YOLO_VIEW, render },
    async execute(args) {
      const config = await readYoloConfig()
      return await callYolo({ token: config.token, baseUrl: resolveBaseUrl(config.baseUrl) }, `/dafeiyu-bridge/result?messageId=${encodeURIComponent(args.messageId)}`, {
        method: 'GET',
      })
    },
  }))
}
// byClaude-end
