/**
 * 管家自主性的提议台账（host 半侧）：巡检器（autonomy.ts）发现的活先落这里，
 * 主人裁决（面板提议卡 / POST 端点）后才转派活——「眼里有活」但「不替主人做主」。
 *
 * ── 设计要点 ────────────────────────────────────────────────────────────
 * 1. 去重以稳定 ID 为准（ones:vos:<uuid>）：同一条活只提议一次，主人 ignored
 *    之后巡检再见到也不再打扰（条目保留，不物理删除）。
 * 2. 台账落 ~/.dafeiyu/proposals.json（tmp + rename 原子写，与 tasks.ts 同款）：
 *    单进程单写者、行数小，JSON 足够。容量上限 PROPOSAL_CAP=100，超出丢最旧
 *    已裁决条目（pending 永不丢）。
 * 3. 裁决动作只有 approve / ignore 两种；派活执行由 autonomy.ts 的回调完成，
 *    成功后回写 sessionId 并把状态转 dispatched——台账只管事实，不管执行细节。
 * 4. 每日派活上限（autonomy 配置）由 autonomy.ts 在 approve 回调里检查，
 *    台账提供 dispatchedSince 计数查询。
 * byClaude
 */
// byClaude-start
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { readAutonomyStatus } from './autonomy.js'
import type { ProposalReport, ProposalStatus } from './client/constants.js'

/** 台账容量上限（超出丢最旧已裁决条目，pending 永不丢）。 */
const PROPOSAL_CAP = 100

/** 台账条目（内部态；对外投影是 ProposalReport）。 */
interface ProposalEntry {
  readonly id: string
  readonly kind: 'ones-requirement'
  readonly title: string
  readonly detail: string
  readonly createdAt: number
  status: ProposalStatus
  decidedAt?: number
  sessionId?: string
}

/**
 * 提议台账：去重登记、主人裁决、对外快照。
 * 生命周期与插件 fiber 一致；构造即异步载入（坏文件按空台账处理）。
 */
export class ProposalStore {
  private readonly ctx: Context
  private readonly file: string
  private entries: ProposalEntry[] = []
  /** 载入门闩：所有读改入口先等它。 */
  private readonly ready: Promise<void>

  constructor(ctx: Context) {
    this.ctx = ctx
    this.file = join(homedir(), '.dafeiyu', 'proposals.json')
    this.ready = this.load()
  }

  /** 载入台账（坏文件按空台账处理，不影响启动）。 */
  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const rows: ProposalEntry[] = []
      for (const row of parsed) {
        if (row === null || typeof row !== 'object') continue
        const e = row as Partial<ProposalEntry>
        if (typeof e.id !== 'string' || e.kind !== 'ones-requirement'
          || typeof e.title !== 'string' || typeof e.detail !== 'string'
          || typeof e.createdAt !== 'number' || !isProposalStatus(e.status)) continue
        rows.push({
          id: e.id,
          kind: e.kind,
          title: e.title,
          detail: e.detail,
          createdAt: e.createdAt,
          status: e.status,
          ...(typeof e.decidedAt === 'number' ? { decidedAt: e.decidedAt } : {}),
          ...(typeof e.sessionId === 'string' ? { sessionId: e.sessionId } : {}),
        })
      }
      this.entries = rows
    } catch {
      this.entries = []
    }
  }

  /** 原子落盘（tmp + rename）；失败只告警不抛。 */
  private async save(): Promise<void> {
    try {
      const dir = join(homedir(), '.dafeiyu')
      await mkdir(dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(this.entries), 'utf8')
      await rename(tmp, this.file)
    } catch (error) {
      this.ctx.logger.warn('dafeiyu: proposal ledger save failed: %o', error)
    }
  }

  /** 对外快照（端点与面板消费）。 */
  report(): readonly ProposalReport[] {
    return this.entries.map(entry => this.project(entry))
  }

  /** 未裁决条目。 */
  pending(): readonly ProposalReport[] {
    return this.entries.filter(entry => entry.status === 'pending').map(entry => this.project(entry))
  }

  /** 单条查询（approve 回调与端点用）。 */
  async find(id: string): Promise<ProposalReport | undefined> {
    await this.ready
    const entry = this.entries.find(row => row.id === id)
    return entry === undefined ? undefined : this.project(entry)
  }

  /**
   * 登记提议：稳定 ID 已存在（任意状态）一律返回 false——同一条活只提议一次，
   * 主人 ignored 后巡检再撞见也不打扰。
   */
  async add(input: {
    readonly id: string
    readonly kind: 'ones-requirement'
    readonly title: string
    readonly detail: string
  }): Promise<boolean> {
    await this.ready
    if (this.entries.some(row => row.id === input.id)) return false
    this.entries.push({
      id: input.id,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      createdAt: Date.now(),
      status: 'pending',
    })
    this.trimToCap()
    await this.save()
    return true
  }

  /**
   * 主人裁决：pending 条目才可裁决；approve 只改状态（派活由调用方回调完成并回写
   * sessionId），ignore 直接落定。
   * @returns 裁决后的条目；ID 不存在或非 pending 返回 undefined（幂等保护：重复
   *   点击、面板与端点并发不会二次派活——状态先行转移，回调只对 approved 条目执行）。
   */
  async decide(id: string, action: 'approve' | 'ignore'): Promise<ProposalReport | undefined> {
    await this.ready
    const entry = this.entries.find(row => row.id === id)
    if (entry === undefined || entry.status !== 'pending') return undefined
    entry.status = action === 'approve' ? 'approved' : 'ignored'
    entry.decidedAt = Date.now()
    await this.save()
    this.ctx.logger.info('dafeiyu: proposal %s %s', id, action)
    return this.project(entry)
  }

  /** 派活成功后回写执行会话，状态转 dispatched。 */
  async markDispatched(id: string, sessionId: string): Promise<void> {
    await this.ready
    const entry = this.entries.find(row => row.id === id)
    if (entry === undefined || entry.status !== 'approved') return
    entry.status = 'dispatched'
    entry.sessionId = sessionId
    await this.save()
  }

  /** 某时刻之后派活的条数（每日上限检查用）。 */
  async dispatchedSince(since: number): Promise<number> {
    await this.ready
    return this.entries.filter(row => row.status === 'dispatched'
      && (row.decidedAt ?? 0) >= since).length
  }

  /** 内部条目 → 对外投影。 */
  private project(entry: ProposalEntry): ProposalReport {
    return {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      detail: entry.detail,
      createdAt: entry.createdAt,
      status: entry.status,
      ...(entry.decidedAt !== undefined ? { decidedAt: entry.decidedAt } : {}),
      ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
    }
  }

  /** 超容量丢最旧已裁决条目（pending 永不丢）。 */
  private trimToCap(): void {
    if (this.entries.length <= PROPOSAL_CAP) return
    const decided = this.entries
      .filter(row => row.status !== 'pending')
      .sort((left, right) => (left.decidedAt ?? left.createdAt) - (right.decidedAt ?? right.createdAt))
    let overflow = this.entries.length - PROPOSAL_CAP
    const drop = new Set<string>()
    for (const row of decided) {
      if (overflow <= 0) break
      drop.add(row.id)
      overflow -= 1
    }
    this.entries = this.entries.filter(row => !drop.has(row.id))
  }
}

function isProposalStatus(value: unknown): value is ProposalStatus {
  return value === 'pending' || value === 'approved' || value === 'ignored' || value === 'dispatched'
}

/**
 * 注册 /api/dafeiyu/proposals 精确路由：
 * GET = 全量快照 + 自主循环心跳（autonomy-status.json，缺席不带）；POST
 * {action:'approve'|'ignore', id} = 主人裁决。
 * approve 的派活执行经 onApprove 回调交给 autonomy（台账只管状态先行转移，
 * 回调失败不回滚——条目停在 approved，主人可重新触发或忽略）。
 * connection 缺席时静默退场（与 tasks 端点同款）。
 */
export function registerProposalsEndpoint(
  ctx: Context,
  store: ProposalStore,
  onApprove: (proposal: ProposalReport) => Promise<{ ok: true; sessionId: string } | { ok: false; message: string }>,
  /** 自主性总开关（面板 A 卡 toggle）：改 ones.enabled 并立即挂/摘巡检定时器。 */
  onSetAutonomy: (enabled: boolean) => Promise<{ ok: true } | { ok: false; message: string }>,
): void {
  ctx.inject(['connection'], scoped => {
    const connection = (scoped as unknown as {
      readonly connection?: {
        readonly fetch?: { readonly register?: (route: unknown) => Promise<() => Promise<void>> }
      }
    }).connection
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return
    const route = {
      path: '/api/dafeiyu/proposals',
      methods: ['GET', 'POST'],
      // ConnectionFetchRoute 契约必填（缺省会被 http-bridge 拒成 400）；与 im/tasks 端点同款。
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        try {
          if (request.method === 'GET') {
            const autonomy = await readAutonomyStatus()
            return Response.json({
              ok: true,
              proposals: store.report(),
              ...(autonomy !== undefined ? { autonomy } : {}),
            })
          }
          const body: unknown = await request.json()
          const record = body === null || typeof body !== 'object' ? undefined : body as Record<string, unknown>
          const action = record?.action
          // 自主性总开关：{action:'autonomy', enabled:boolean}，成功附最新心跳。
          if (action === 'autonomy') {
            if (typeof record?.enabled !== 'boolean') {
              return Response.json({ ok: false, message: 'expected {action: autonomy, enabled: boolean}' }, { status: 400 })
            }
            const outcome = await onSetAutonomy(record.enabled)
            if (!outcome.ok) return Response.json({ ok: false, message: outcome.message }, { status: 502 })
            return Response.json({ ok: true, autonomy: await readAutonomyStatus() })
          }
          const id = typeof record?.id === 'string' ? record.id : undefined
          if (id === undefined || (action !== 'approve' && action !== 'ignore')) {
            return Response.json({ ok: false, message: 'expected {id, action: approve|ignore} or {action: autonomy, enabled: boolean}' }, { status: 400 })
          }
          if (action === 'ignore') {
            const decided = await store.decide(id, 'ignore')
            if (decided === undefined) return Response.json({ ok: false, message: 'proposal not pending' }, { status: 409 })
            return Response.json({ ok: true, proposal: decided })
          }
          // approve：状态先行转移（防重复点击二次派活），再执行派活回调。
          const approved = await store.decide(id, 'approve')
          if (approved === undefined) return Response.json({ ok: false, message: 'proposal not pending' }, { status: 409 })
          const outcome = await onApprove(approved)
          if (!outcome.ok) {
            return Response.json({ ok: false, message: outcome.message, proposal: approved }, { status: 502 })
          }
          await store.markDispatched(id, outcome.sessionId)
          const dispatched = await store.find(id)
          return Response.json({ ok: true, proposal: dispatched ?? approved })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return Response.json({ ok: false, message }, { status: 500 })
        }
      },
    }
    void register(route).then(dispose => {
      scoped.effect(() => () => { void dispose() }, 'dafeiyu: proposals endpoint route')
    }, (error: unknown) => {
      scoped.logger.warn('dafeiyu: proposals endpoint route rejected: %o', error)
    })
  })
}
// byClaude-end
