# 大肥鱼（dafeiyu）

DeepSeek Harness（dsh ≥ 0.2.2-alpha）的**对话管家**插件：鲸鱼娘管家帮你管理项目与对话。所有管理动作在聊天里一句话交代，管家自己决定新建还是复用对话；右侧三态看板随时看清哪些在跑、哪些等你确认。

## 形态

**管家舞台（主面板，v3）**

- 侧边栏「🐟 大肥鱼」面板行 +「更多」菜单入口。
- 左侧舞台：**鲸鱼娘**人形形象（精灵图帧动画，参考 dsh-web-ui 的 dsh-pet 桌宠）+ 说话气泡（实时显示管家最新回复）+ 自定义输入条；待机播 idle 轨（站立呼吸），回答中播 running 轨（伏案工作）并顶出三点思考气泡，状态文字与「正在想… / 随时待命」联动。
- 右侧三态看板（常驻）：
  - **进行中**：`running === true` 的对话，绿点脉冲；
  - **待确认**：近 48h 活动过、没在跑的对话，可点 ✓ 手动收尾（本地记忆，上限 50 条）；
  - **已完成**：其余对话折叠展示，点击展开。
  - 全部过滤空白、子代理与已归档会话；点卡片跳官方对话视图。
- 管家会话自动定位/创建：本地记忆 id → 标题「大肥鱼管家」匹配（要求 cwd 是管家之家）→ 在管家之家新建并改名；绑定工作区才可用（否则 composer 卡在选工作区）。**管家之家工作区与管家会话行对用户隐身**（见「已知边界」）。

**助手工具面（管家的手，聊天里由管家调用）**

| 工具 | 作用 |
|------|------|
| `fatfish_workspace_list` / `fatfish_workspace_create` / `fatfish_workspace_rename` / `fatfish_workspace_remove` | 列出 / 新建（注册目录）/ 重命名 / 移除项目 |
| `fatfish_session_list` / `fatfish_session_create` / `fatfish_session_rename` / `fatfish_session_archive` / `fatfish_session_unarchive` / `fatfish_session_pin` | 列出（可按项目过滤、全文搜索）/ 新建 / 重命名 / 归档 / 恢复 / 置顶对话 |
| `fatfish_session_handoff` | 把当前对话携带全部上下文交接到一个新对话（官方 fork 能力：复制到最近完成轮次或指定 atSeq） |
| `fatfish_context_status` / `fatfish_context_compact` | 查看当前对话上下文负载（事件数/消息数/已压缩区域）/ 立即压缩（compaction） |

## 素材来源与授权

鲸鱼娘精灵图裁剪自 [tramington/dsh-web-ui](https://github.com/tramington/dsh-web-ui) 的 `packages/dsh-pet/assets/whale`（原作者 zhu1090093659，**Apache-2.0**）：原图 8×9 帧（192×208/帧），本插件取 idle（6 帧）与 running（6 帧）两行，以 data URL 内联进 client bundle（`src/client/whaleSprite.ts` 为生成文件）。完整原图与 pet.json 保存在 `assets/whale/` 供后续扩展其余轨道（waving/jumping/failed/waiting/review…）。

## 构建

```sh
pnpm install
pnpm run build     # tsc → lib/types，tsdown → lib/index.js（host）+ lib/client.js（浏览器 factory）
pnpm run typecheck
```

## 安装到 dsh

从 deepseek-harness 源码运行时（`pnpm dsh`）：

```sh
cd <deepseek-harness>
# profile 不存在时先从官方 web 模板创建（已存在则跳过）
pnpm dsh --profile dafeiyu --from-default-profile web --dump-config
pnpm dsh plugin --profile dafeiyu add D:/wks-vos/dafeiyu
pnpm dsh --profile dafeiyu
```

`dsh plugin add` 会把本包 link 进 profile 并把 bundle 层写入 `dsh.profile.bundles`；启动后 web-app 自起服务（注意：不能写 `dsh --profile X web`，会报 too many arguments），侧边栏即出现大肥鱼入口。

## 目录结构

```
src/
├── index.ts            # host 半侧：注册 fatfish_* 工具
├── workspaces.ts       # 项目工具
├── sessions.ts         # 对话工具
├── handoff.ts          # 上下文交接（fork）
├── context.ts          # 上下文体检与压缩
└── client/
    ├── index.ts          # client 半侧：面板行 + 更多菜单 + 管家主面板注册
    ├── ButlerPanel.tsx   # 管家舞台：形象+气泡+输入条（左）+ 三态看板（右）
    ├── ButlerFish.tsx    # 鲸鱼娘精灵图帧动画（idle/running 双轨）
    ├── whaleSprite.ts    # 生成的精灵图 data URL + 轨道表（勿手改）
    ├── FatfishIcon.tsx   # 侧边栏面板行图标
    ├── FatfishMoreRow.tsx# 「更多」菜单入口
    ├── homeFilter.ts     # 管家之家隐身：workspaces 快照投影 + 会话行隐藏样式
    └── locales.ts      # zh/en 文案
assets/whale/            # 素材原件（spritesheet.webp + pet.json + 裁剪产物）
```

## 已知边界

- dsh 无内置 handoff：本插件的 handoff = 官方 `session.fork`（复制完整事件前缀），交接后新对话自带全部历史。
- dsh 的删除语义是归档（历史保留）：`fatfish_session_archive` 即产品删除，无物理删除 RPC。
- 三态是客户端推导（sessionListMetadata 不可写、无通用 RPC）：进行中=running，待确认=近 48h 活动 + 未手动 ✓，已完成=其余 + 手动 ✓；已归档会话从 workspaces 归档集过滤，不看板展示。
- 管家会话依赖绑定一个已注册工作区（管家之家 `~/.dafeiyu/home`，host 启动时注册）来获得可用 composer；无工作区的空白「大肥鱼管家」会话会被跳过并另建。
- **管家之家隐身**（dsh 无「隐藏工作区」API，client 侧实现）：对 `workspaces.list` 源的快照做投影，管家之家不进 `items`——侧边栏浏览区、空白会话的工作区选择器、新建会话的工作区继承都读这同一个源，因此分组的「+」、选择器、继承兜底全部不再指向管家之家，也无处添加新会话；管家会话自身落到「未分组」桶，用 `data-row-key` 样式规则藏行。管家会话的 composer 不受投影影响（官方 ConversationContent 的 chip 标题有 cwd 兜底）。`fatfish_session_create` 同步拒绝在管家之家开对话。已知残留：搜索结果里仍可能搜到管家会话；未分组桶的折叠计数可能把它计入。
- client bundle 由本包自带简化版 tsdown 配置产出（closure-factory CJS），与官方 `packages/client/tsdown.client.ts` 预设相比省略了 CSS Modules 与资产管线——精灵图以 base64 data URL 内联，样式内联注入。

<!-- Contains claude-generated edits. -->
