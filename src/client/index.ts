/**
 * 大肥鱼 client 半侧：管家舞台主面板（鲸鱼娘 + 三态看板）+ 侧边栏面板行 +「更多」菜单入口。
 * 管家会话是单一常驻对话，只住「管家之家」专属工作区（不属于任何用户项目），
 * 按「本地记忆 id → 管家之家里标题匹配 → 管家之家里新建改名」三级定位，面板持有期间 retain。
 * byClaude
 */
// byClaude-start
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions, SessionReference, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { FatfishMoreRow, type FatfishMoreInjected } from './FatfishMoreRow.js'
import { ButlerPanel, type ButlerInjected, type ModelCatalogLike, type ModelSelectionLike } from './ButlerPanel.js'
import { ButlerChatHost } from './ButlerChatHost.js'
import { FatfishIcon } from './FatfishIcon.js'
import { BUTLER_TITLE, isButlerHomePath } from './constants.js'
import { installHomeFilter, rawWorkspaceSnapshot, removeHiddenButlerStyle, setHiddenButlerSession } from './homeFilter.js'
import { NS, zh, en, type DafeiyuKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 大肥鱼管家面板与菜单文案。 */
    dafeiyu: DafeiyuKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 大肥鱼管家面板内嵌的官方对话宿主（管家会话作用域）。 */
    'dafeiyu.butler.chat': { kind: 'single'; scope: 'session' }
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** 大肥鱼管家面板对管家会话的持有来源。 */
    dafeiyuButler: unknown
  }
}

/** 需要的浏览器服务：slot 注册表、文案、会话/工作区数据、导航与面板布局。 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'layout']

/** 管家会话的持久记忆键。 */
const BUTLER_STORAGE_KEY = 'dafeiyu.butler.sessionId'

/**
 * 能当管家的会话：cwd 必须是管家之家目录，且未归档。
 * 仅「cwd 存在」不够——无工作区新建的空白会话也带 host 默认 cwd，
 * hero 会一直卡在「选择工作区」，composer 不可用。
 */
function usableAsButler(
  row: SessionSummary | undefined,
  archivedIds: ReadonlySet<string>,
): row is SessionSummary {
  return row !== undefined && row.cwd !== undefined && isButlerHomePath(row.cwd)
    && !archivedIds.has(row.id)
}

/** 面板可能在 boot 后立刻打开，管家之家还没注册到位：等它出现在列表里，最多 8 秒。
 * 读全量快照——管家之家已被投影出对用户可见的 items（homeFilter）。 */
async function waitForButlerHome(workspaces: IWorkspaces): Promise<WorkspaceView | undefined> {
  const find = (): WorkspaceView | undefined =>
    rawWorkspaceSnapshot().items.find(ws => isButlerHomePath(ws.path))
  const immediate = find()
  if (immediate !== undefined) return immediate
  return await new Promise(resolve => {
    const settle = (): void => {
      cleanup()
      resolve(find())
    }
    const check = (): void => {
      if (find() !== undefined) settle()
    }
    const unsubscribe = workspaces.list.subscribe(() => { check() })
    const timer = window.setTimeout(() => { settle() }, 8000)
    function cleanup(): void {
      unsubscribe()
      window.clearTimeout(timer)
    }
    check()
  })
}

/**
 * 等会话目录首次拉取完成（phase ready）：boot 期 byId 还是空的，
 * 直接查表会把「尚未加载」误判成「管家不存在」而重复新建。
 */
async function waitForSessionListReady(sessions: ISessions): Promise<void> {
  if (sessions.list.getSnapshot().phase === 'ready') return
  await new Promise<void>(resolve => {
    const settle = (): void => {
      cleanup()
      resolve()
    }
    const check = (): void => {
      if (sessions.list.getSnapshot().phase === 'ready') settle()
    }
    const unsubscribe = sessions.list.subscribe(() => { check() })
    const timer = window.setTimeout(() => { settle() }, 8000)
    function cleanup(): void {
      unsubscribe()
      window.clearTimeout(timer)
    }
    check()
  })
}

/**
 * 定位管家会话（单一常驻对话）：本地记忆的 id 仍指向管家之家就用它；
 * 否则在管家之家里按标题找；都没有就在管家之家新建并改名。
 * @param sessions - 会话服务。
 * @param workspaces - 工作区服务。
 * @returns 管家会话 id；管家之家未就绪时抛错，面板显示错误态。
 */
async function doEnsureButlerSession(sessions: ISessions, workspaces: IWorkspaces): Promise<SessionId> {
  const home = await waitForButlerHome(workspaces)
  if (home === undefined) throw new Error('butler home workspace not ready')
  await waitForSessionListReady(sessions)
  const archived = new Set(rawWorkspaceSnapshot().archivedSessionIds)
  const stored = window.localStorage.getItem(BUTLER_STORAGE_KEY)
  if (stored !== null) {
    const remembered = sessions.list.getSnapshot().byId[stored as SessionId]
    if (usableAsButler(remembered, archived)) return remembered.id
    window.localStorage.removeItem(BUTLER_STORAGE_KEY)
  }
  const snapshot = sessions.list.getSnapshot()
  const existing = snapshot.ids
    .map(id => snapshot.byId[id])
    .find(row => row?.title === BUTLER_TITLE && usableAsButler(row, archived))
  if (existing !== undefined) {
    window.localStorage.setItem(BUTLER_STORAGE_KEY, existing.id)
    return existing.id
  }
  const created = await sessions.create({ workspaceId: home.workspaceId })
  // 改名只是让会话列表里认得出这条管家线，失败不影响使用。
  await sessions.using(created, { source: 'dafeiyuButler' }, reference =>
    reference.binding.session.rename(BUTLER_TITLE)).catch(() => undefined)
  window.localStorage.setItem(BUTLER_STORAGE_KEY, created)
  return created
}

/** 单飞 promise：Web Locks 不可用时的进程内互斥兜底。 */
let inflightEnsure: Promise<SessionId> | undefined

/**
 * 单飞 + 跨标签互斥：StrictMode 双挂载与双标签首开面板都只允许一个
 * 定位/新建在跑，杜绝竞态双建管家会话（Web Locks 不可用时退化为进程内单飞）。
 */
async function ensureButlerSession(sessions: ISessions, workspaces: IWorkspaces): Promise<SessionId> {
  const run = (): Promise<SessionId> => doEnsureButlerSession(sessions, workspaces)
  const id = await (navigator.locks !== undefined
    ? navigator.locks.request('dafeiyu.butler', { mode: 'exclusive' }, run)
    : (inflightEnsure ??= run().finally(() => { inflightEnsure = undefined })))
  // 管家会话行在侧边栏「未分组」桶里，解析出 id 后校正隐身规则。
  setHiddenButlerSession(id)
  return id
}

/**
 * 注册大肥鱼的三处 UI：侧边栏面板行、管家主面板（含内嵌聊天子槽）、更多菜单行。
 * @param ctx - 浏览器上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dafeiyu: dictionaries')
  // 管家之家隐身：在 workspaces.list 源上装投影（侧边栏浏览区、工作区选择器、
  // 新建会话的工作区继承都读它），并按本地记忆先藏掉管家会话行（ensure 后校正）。
  ctx.effect(() => {
    const restore = installHomeFilter(ctx.workspaces)
    setHiddenButlerSession(window.localStorage.getItem(BUTLER_STORAGE_KEY) ?? undefined)
    return () => {
      restore()
      removeHiddenButlerStyle()
    }
  }, 'dafeiyu: butler-home projection')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as unknown as ISessions

  // byClaude-start 模型目录/选择面：经 session manager 的 remote namespace（公开 ISessions 未暴露，运行时探测；不可用则面板退化为无选择器）（byClaude）
  const models: ButlerInjected['models'] = (() => {
    try {
      const ns = (sessions as unknown as {
        manager?: { remote?: { session?: { modelCatalog?: unknown; selectModel?: unknown } } }
      }).manager?.remote?.session
      const catalog = ns?.modelCatalog
      const select = ns?.selectModel
      if (typeof catalog !== 'function' || typeof select !== 'function') return null
      return {
        catalog: async () => {
          try {
            const loaded: unknown = await (catalog as (this: unknown) => Promise<unknown>).call(ns)
            // remote 方法返回 {ok, value} 结果包装，目录在 value 里；形状不符一律按不可用处理。
            const result = loaded as { ok?: boolean; value?: unknown } | null
            const unwrapped: unknown = result !== null && result.ok === true ? result.value : loaded
            const shaped = unwrapped as { groups?: unknown; default?: unknown } | null
            if (shaped === null || typeof shaped !== 'object' || !Array.isArray(shaped.groups) || shaped.default === undefined) return null
            return unwrapped as ModelCatalogLike
          } catch {
            return null
          }
        },
        select: async (sessionId: SessionId, selection: ModelSelectionLike) => {
          try {
            const request: Record<string, unknown> = { sessionId, provider: selection.provider, model: selection.model }
            if (selection.reasoningEffort !== undefined) request.reasoningEffort = selection.reasoningEffort
            const ret: unknown = await (select as (this: unknown, request: Record<string, unknown>) => Promise<unknown>).call(ns, request)
            const result = ret as { ok?: boolean } | null
            return result?.ok !== false
          } catch {
            return false
          }
        },
      }
    } catch {
      return null
    }
  })()
  // byClaude-end

  const PANEL_ID = 'dafeiyu'
  const panelId = PANEL_ID as Parameters<typeof ctx.layout.selectPanel>[0]

  const injected: ButlerInjected = {
    hooks: { sessionList: sessions.list, workspaceList: ctx.workspaces.list },
    models,
    acquire: async (): Promise<SessionReference> => {
      const id = await ensureButlerSession(sessions, ctx.workspaces)
      return sessions.retain(id, { source: 'dafeiyuButler' })
    },
    openSession: sessionId => { ctx.uiWorkspace.openSession(sessionId) },
  }

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 25,
    locale: NS,
    label: () => t('panel.title'),
  }, FatfishIcon)), 'dafeiyu: sidebar panel row')

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    // 声明 session 作用域子槽让面板组件获得 SessionProvider + renderSlot 注入，
    // 用于把官方 conversation.content 桥进管家面板（ButlerChatHost）。
    children: { 'dafeiyu.butler.chat': { kind: 'single', scope: 'session' } },
    inject: () => injected,
  }, ButlerPanel)), 'dafeiyu: butler stage panel')

  ctx.effect(() => ctx.slots.inject('dafeiyu.butler.chat', () => ctx.slots.register({
    name: 'dafeiyu.butler.chat',
  }, ButlerChatHost)), 'dafeiyu: butler conversation host')

  const moreInjected: FatfishMoreInjected = {
    openPanel: () => { ctx.layout.selectPanel(panelId) },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
    name: 'sidebar.panellist.actions',
    id: PANEL_ID,
    locale: NS,
    inject: () => moreInjected,
  }, FatfishMoreRow)), 'dafeiyu: more menu row')
}
// byClaude-end
