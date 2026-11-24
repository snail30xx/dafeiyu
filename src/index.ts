/**
 * 大肥鱼 host 半侧：把项目（Workspace）与对话（Session）管理注册为
 * fatfish_* 助手工具，让用户在聊天里一句话完成管理动作。
 * 复用宿主已有的 sessionController / workspaceController / workspaceRegistry /
 * compaction 服务，不重建业务逻辑。
 * @module dafeiyu
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 拉入各服务的 Context 声明合并（sessionController/workspaceController/workspaceRegistry/compaction）。
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerCompactTool, registerContextTools } from './context.js'
import { registerHandoffTool } from './handoff.js'
import { bindImPush, detectImConfigured, registerImEndpoint, syncImMarkerWorkspace } from './im.js'
import { AutonomyLoop } from './autonomy.js'
import { ProposalStore, registerProposalsEndpoint } from './proposals.js'
import { registerSessionTools } from './sessions.js'
import { TaskTracker, registerTasksEndpoint } from './tasks.js'
import { registerYoloTools } from './yolo.js'
import { registerWorkspaceTools } from './workspaces.js'
import { BUTLER_HOME_TITLE } from './client/constants.js'
import { TEAM_AGENTS } from './client/constants.js'
import { BUTLER_PERSONA_MD, TEAM_PERSONAS_ALL } from './persona.js'

/** Loader 注册的插件名。 */
export const name = 'dafeiyu'

/** 宿主服务：工具注册表与被复用的会话/项目服务；compaction 按部署可选。 */
export const inject = ['tools', 'sessionController', 'workspaceController', 'workspaceRegistry']

/** 管家之家：管家会话的专属工作区，独立于任何用户项目。 */
const butlerHomeTitle = BUTLER_HOME_TITLE

/** 注册全部大肥鱼工具；dispose 所属 fiber 即整体注销。 */
export function apply(ctx: Context): void {
  // byClaude-start 派活完成自动总结与汇报：台账落盘 + 完成检测监听 + 面板数据端点。
  // 台账在构造器里异步载入（坏文件按空台账），判定规则与去抖见 tasks.ts 文件头。（byClaude）
  const tracker = new TaskTracker(ctx)
  ctx.effect(() => tracker.start(), 'dafeiyu: task completion tracker')
  registerTasksEndpoint(ctx, tracker)
  // byClaude-end
  // byClaude-start 管家自主性（眼里有活）：ONES 巡检差分出新需求落提议台账并推钉钉，
  // 面板批准后经端点回调派活到 vos-agent-dev 跑 req-dev-pipeline（巡检口径与派活
  // 内核见 autonomy.ts 文件头）；yolo 工单执行器包装成助手工具（运维工单的手）。（byClaude）
  const proposals = new ProposalStore(ctx)
  const autonomy = new AutonomyLoop(ctx, proposals, tracker)
  ctx.effect(() => autonomy.start(), 'dafeiyu: autonomy loop')
  registerProposalsEndpoint(ctx, proposals, proposal => autonomy.dispatchProposal(proposal), enabled => autonomy.setEnabled(enabled))
  registerYoloTools(ctx)
  // byClaude-end
  registerWorkspaceTools(ctx)
  registerSessionTools(ctx, tracker)
  registerHandoffTool(ctx)
  registerContextTools(ctx)
  // 压缩服务由部署组合决定（Web 组合默认关闭 compaction-basic）；
  // 可用时才向助手暴露 fatfish_context_compact。
  ctx.inject(['compaction'], scope => {
    scope.effect(() => registerCompactTool(scope), 'dafeiyu: compact tool')
  })

  // 管家之家工作区：目录不存在则创建（workspaceRegistry 只注册不建盘），
  // 注册幂等（同路径返回已有工作区），失败只告警不阻塞宿主启动。
  // AGENTS.md 人格播种用 'wx'：只在文件不存在时写入，主人改过的人格永不被覆盖。
  const home = join(homedir(), '.dafeiyu', 'home')
  void (async () => {
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'AGENTS.md'), BUTLER_PERSONA_MD, { flag: 'wx' }).catch(() => undefined)
    await ctx.workspaceRegistry.create(home, butlerHomeTitle)
  })().catch((error: unknown) => {
    ctx.logger.warn('dafeiyu: butler home workspace unavailable: %o', error)
  })

  // byClaude-start IM（钉钉机器人）配置：权威口径 = dsh-im 的连接配置表
  // （$DSH_HOME/sdb/application.sqlite 的 im_connection_settings，行数>0 即已配置），
  // ~/.dafeiyu/im.json 兜底；host 把该事实同步成标记工作区（~/.dafeiyu/im）带给
  // 面板——dsh 无 host→client 配置通道（byClaude）
  void (async () => {
    await syncImMarkerWorkspace(ctx, await detectImConfigured())
  })().catch((error: unknown) => {
    ctx.logger.warn('dafeiyu: im marker workspace unavailable: %o', error)
  })
  // byClaude-end
  // byClaude-start /api/dafeiyu/im 精确路由：面板勾选框经同源 HTTP 直调同宿主 dsh-im
  // 服务（通用通道 RPC 在 web 壳没有 HTTP 载体）；connection/im 缺席时静默退场（byClaude）
  registerImEndpoint(ctx)
  // byClaude-end
  // byClaude-start 钉钉出站推送端口：同宿主 dsh-im 就绪即绑定（提议/任务完成推送
  // 首选 Stream 机器人，im.json webhook 兜底）；im 缺席/卸载自动置空回退（byClaude）
  bindImPush(ctx)
  // byClaude-end
  // byClaude-start agent team 聊天室：每成员一个独立工作区（~/.dafeiyu/team/<id>/），
  // AGENTS.md 播种角色与技能域——上下文互不污染（byClaude）
  void (async () => {
    for (const agent of TEAM_AGENTS) {
      const persona = TEAM_PERSONAS_ALL[agent.id]
      if (persona === undefined) continue
      const dir = join(homedir(), '.dafeiyu', 'team', agent.id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'AGENTS.md'), persona, { flag: 'wx' }).catch(() => undefined)
      await ctx.workspaceRegistry.create(dir, `肥鱼团队·${agent.name}`)
    }
  })().catch((error: unknown) => {
    ctx.logger.warn('dafeiyu: team home workspaces unavailable: %o', error)
  })
  // byClaude-end
}

// Contains claude-generated edits.
