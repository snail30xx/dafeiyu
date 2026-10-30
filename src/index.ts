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
import { registerSessionTools } from './sessions.js'
import { registerWorkspaceTools } from './workspaces.js'
import { BUTLER_HOME_TITLE } from './client/constants.js'
import { BUTLER_PERSONA_MD } from './persona.js'

/** Loader 注册的插件名。 */
export const name = 'dafeiyu'

/** 宿主服务：工具注册表与被复用的会话/项目服务；compaction 按部署可选。 */
export const inject = ['tools', 'sessionController', 'workspaceController', 'workspaceRegistry']

/** 管家之家：管家会话的专属工作区，独立于任何用户项目。 */
const butlerHomeTitle = BUTLER_HOME_TITLE

/** 注册全部大肥鱼工具；dispose 所属 fiber 即整体注销。 */
export function apply(ctx: Context): void {
  registerWorkspaceTools(ctx)
  registerSessionTools(ctx)
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
}

// Contains claude-generated edits.
