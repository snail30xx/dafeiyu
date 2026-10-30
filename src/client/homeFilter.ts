/**
 * 管家之家隐身（client 侧投影）：宿主没有「隐藏工作区」口子——Workspace 记录
 * 只有 path/title/sessionIds/时间戳，WorkspaceBrowser 逐组全量渲染，根数据钩子
 * 也没有覆盖通道（provideRoot 的钩子名全局唯一）。因此对 workspaces.list 源对象
 * 的 getSnapshot 做一层包装：管家之家（~/.dafeiyu/home）不进 items，其余字段
 * 原样透传。两处已验证不会因此破裂：
 * - 侧边栏浏览区与空白会话的工作区选择器都读 useWorkspaces 根钩子，而该钩子
 *   绑定的正是 workspaces.list 这个源对象（ui-workspace 的 provideRoot）；
 * - 管家会话的 composer 不依赖工作区留在列表里：ConversationContent 的 chip
 *   标题有 cwd 兜底（workspaceLabel(cwd)），cwd 还在就不会 inert。
 * 管家会话自身仍由 sessions.list 全量提供，工作区被投影后它落在浏览区
 * 「未分组」桶里，用一条按 data-row-key 的样式规则藏掉那一行。
 */
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { isButlerHomePath } from './constants.js'

/** 已安装源对象登记：防重复包装（插件重载先 dispose 再装，正常不会命中）。 */
const patched = new WeakSet<object>()

/** 原始快照读取；过滤安装前调用属于装配错误，直接抛。 */
let rawRead: (() => WorkspaceSnapshot) | undefined

/** 过滤安装后仍取全量工作区快照（定位管家之家、归档集判断用）。 */
export function rawWorkspaceSnapshot(): WorkspaceSnapshot {
  const read = rawRead
  if (read === undefined) throw new Error('dafeiyu: butler-home filter is not installed')
  return read()
}

/**
 * 在 workspaces.list 源上安装管家之家投影。
 * @param workspaces - 工作区服务（useWorkspaces 根钩子与它是同一源对象）。
 * @returns 卸载投影、还原原始 getSnapshot 的 disposer。
 */
export function installHomeFilter(workspaces: IWorkspaces): () => void {
  const source = workspaces.list
  if (patched.has(source)) return () => {}
  patched.add(source)
  const readRaw = source.getSnapshot.bind(source)
  rawRead = readRaw
  // uSES 契约：快照在两次失效之间必须引用稳定，按原始快照身份缓存投影。
  let cache: { raw: WorkspaceSnapshot; view: WorkspaceSnapshot } | undefined
  source.getSnapshot = (): WorkspaceSnapshot => {
    const raw = readRaw()
    if (cache?.raw === raw) return cache.view
    const view: WorkspaceSnapshot = { ...raw, items: raw.items.filter(ws => !isButlerHomePath(ws.path)) }
    cache = { raw, view }
    return view
  }
  return () => {
    patched.delete(source)
    // getSnapshot 原本是原型方法：这里写回绑定原函数，行为与还原原型一致。
    source.getSnapshot = readRaw as typeof source.getSnapshot
    if (rawRead === readRaw) rawRead = undefined
  }
}

/** 隐身样式元素 id（注入一次，内容随管家会话 id 更新）。 */
const STYLE_ID = 'dafeiyu-butler-hide'

/** 会话 id 只放行安全字符，防选择器注入。 */
const SAFE_SESSION_ID = /^[\w-]{1,128}$/

/**
 * 藏掉侧边栏里管家会话自身那一行（浏览区分组行与平铺行都用 data-row-key）。
 * @param sessionId - 管家会话 id；undefined 清空规则。
 */
export function setHiddenButlerSession(sessionId: string | undefined): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.append(style)
  }
  style.textContent = sessionId !== undefined && SAFE_SESSION_ID.test(sessionId)
    ? `[data-row-key="session:${sessionId}"]{display:none!important}`
    : ''
}

/** 移除隐身样式元素（插件卸载时还原侧边栏原貌）。 */
export function removeHiddenButlerStyle(): void {
  if (typeof document === 'undefined') return
  document.getElementById(STYLE_ID)?.remove()
}
