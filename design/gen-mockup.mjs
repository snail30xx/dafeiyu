/**
 * 生成大肥鱼管家 v8 视觉稿 HTML（窗前场景 + 官方 composer 复用样式 + DSH 蓝风格 + 悬浮卡片）。
 * 用法：node design/gen-mockup.mjs（在 dafeiyu 仓库根目录跑）
 * byClaude
 */
// byClaude-start
import { readFile, writeFile } from 'node:fs/promises'

const sprite = (await readFile('design/.sprite-url.txt', 'utf8')).trim()

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>大肥鱼管家 · 视觉稿 v8</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 800px; overflow: hidden; }
  body { display: flex; background: #f4f6fb; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #2b3038; }

  /* DSH 侧边栏示意 */
  .dsh-rail { width: 60px; background: #eef1f8; border-right: 1px solid rgba(77,107,254,0.10); display: flex; flex-direction: column; align-items: center; padding: 14px 0; gap: 16px; }
  .rail-logo { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, #4d6bfe, #3d55d6); color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .rail-item { width: 32px; height: 32px; border-radius: 10px; background: rgba(77,107,254,0.07); }
  .rail-item.on { background: #fff; box-shadow: 0 2px 8px rgba(61,85,214,0.14); }

  /* 主面板：上=场景+看板两栏悬浮卡，下=官方 composer */
  .app { flex: 1; display: flex; flex-direction: column; padding: 22px 26px 18px; gap: 14px; }
  .main { flex: 1; display: flex; gap: 18px; min-height: 0; }

  /* 悬浮场景卡片：窗前 */
  .scene { position: relative; flex: 1; border-radius: 26px; background: linear-gradient(180deg, #ffffff 0%, #f0f4fd 100%); box-shadow: 0 24px 56px rgba(61,85,214,0.13), inset 0 0 0 1px rgba(77,107,254,0.08); overflow: hidden; }

  /* 大飘窗：窗框 + 窗外天空渐变 + 云 + 天际线 */
  .window { position: absolute; left: 50%; top: 30px; bottom: 96px; width: min(74%, 640px); transform: translateX(-46%); border-radius: 18px; background: linear-gradient(180deg, #dce7fb 0%, #edf2fe 55%, #f7f0e4 100%); box-shadow: inset 0 0 0 3px #ffffff, inset 0 0 0 4.5px rgba(93,116,196,0.22), 0 10px 30px rgba(61,85,214,0.08); overflow: hidden; }
  .cloud { position: absolute; border-radius: 999px; background: rgba(255,255,255,0.85); }
  .cloud-1 { width: 120px; height: 30px; left: 10%; top: 34px; }
  .cloud-2 { width: 76px; height: 22px; left: 34%; top: 70px; opacity: 0.7; }
  .cloud-3 { width: 96px; height: 26px; right: 12%; top: 50px; opacity: 0.8; }
  .sky { position: absolute; bottom: 0; border-radius: 2px 2px 0 0; background: rgba(93,116,196,0.20); }
  .sky:nth-child(4) { left: 8%; width: 46px; height: 64px; }
  .sky:nth-child(5) { left: 16%; width: 30px; height: 96px; background: rgba(93,116,196,0.13); }
  .sky:nth-child(6) { left: 24%; width: 58px; height: 48px; }
  .sky:nth-child(7) { left: 33%; width: 34px; height: 78px; background: rgba(93,116,196,0.13); }
  .sky:nth-child(8) { right: 10%; width: 42px; height: 82px; }
  .sky:nth-child(9) { right: 19%; width: 60px; height: 50px; background: rgba(93,116,196,0.13); }
  .sky:nth-child(10) { right: 30%; width: 30px; height: 92px; }
  .mullion-v { position: absolute; left: 50%; top: 0; bottom: 0; width: 5px; transform: translateX(-50%); background: rgba(255,255,255,0.9); box-shadow: 0 0 0 1px rgba(93,116,196,0.16); }
  .mullion-h { position: absolute; left: 0; right: 0; top: 38%; height: 5px; background: rgba(255,255,255,0.9); box-shadow: 0 0 0 1px rgba(93,116,196,0.16); }

  /* 地面光带：人物落脚 */
  .floor { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: linear-gradient(to top, #e6ebf9 0%, rgba(230,235,249,0.45) 60%, transparent); }
  .floor-glow { position: absolute; left: 50%; bottom: 26px; width: 300px; height: 34px; transform: translateX(-48%); border-radius: 50%; background: radial-gradient(closest-side, rgba(93,116,196,0.22), transparent 72%); }

  /* 大人物（窗前） */
  .whale { position: absolute; left: 50%; bottom: 34px; transform: translateX(-48%); width: 390px; height: 423px; background-image: url(${sprite}); background-size: 600% 200%; background-position: 0% 0%; background-repeat: no-repeat; z-index: 2; }

  /* 头部（悬浮卡片内左上） */
  .header { position: absolute; top: 20px; left: 24px; display: flex; align-items: center; gap: 12px; z-index: 5; }
  .header h1 { font-size: 20px; font-weight: 650; }
  .avatar { width: 36px; height: 36px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2.5px rgba(77,107,254,0.30), 0 4px 12px rgba(61,85,214,0.16); display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .pill-idle { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; background: #fff; border: 1px solid rgba(77,107,254,0.18); font-size: 12px; color: #5a6474; }
  .pill-idle i { width: 7px; height: 7px; border-radius: 50%; background: #22a06b; }
  .stat { font-size: 12px; color: #98a1b3; }

  .bubble { position: absolute; right: 26px; top: 92px; width: 300px; background: #fff; border: 1px solid rgba(77,107,254,0.28); border-radius: 18px; padding: 13px 15px; font-size: 13px; line-height: 1.75; color: #3a4150; box-shadow: 0 12px 30px rgba(61,85,214,0.12); z-index: 4; }
  .bubble::before { content: ''; position: absolute; left: -6px; top: 28px; width: 12px; height: 12px; background: #fff; border-left: 1px solid rgba(77,107,254,0.28); border-top: 1px solid rgba(77,107,254,0.28); transform: rotate(45deg); }

  /* 悬浮看板卡片 */
  .board { width: 372px; background: #fff; border-radius: 24px; box-shadow: 0 24px 56px rgba(61,85,214,0.13), inset 0 0 0 1px rgba(77,107,254,0.06); padding: 20px 18px; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
  .board-title { display: flex; align-items: baseline; gap: 8px; padding: 0 4px; }
  .board-title h2 { font-size: 15px; font-weight: 650; }
  .board-title .n { font-size: 12px; color: #98a1b3; font-weight: 400; }
  .sec-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #4c5566; padding: 2px 4px; }
  .sec-title .tag { padding: 1.5px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 500; }
  .tag-run { background: #e7ecfe; color: #3d55d6; }
  .tag-wait { background: #faf3d8; color: #a08b3c; }
  .tag-done { background: #e8f3e4; color: #5f9155; }
  .row { display: flex; align-items: center; gap: 10px; padding: 11px 13px; border-radius: 14px; background: #f4f6fc; margin-top: 7px; }
  .row .t { flex: 1; min-width: 0; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #3a4150; }
  .row .time { font-size: 11px; color: #98a1b3; flex-shrink: 0; }
  .st { flex-shrink: 0; padding: 2.5px 10px; border-radius: 999px; font-size: 11px; }
  .st-run { background: #4d6bfe; color: #fff; }
  .st-ok { background: #22a06b; color: #fff; }
  .ck { flex-shrink: 0; width: 20px; height: 20px; border-radius: 7px; border: 1.5px solid #ccd3e4; color: #a6aec2; font-size: 11px; display: flex; align-items: center; justify-content: center; }
  .more { text-align: center; font-size: 12px; color: #98a1b3; padding: 6px 0 2px; }

  /* 底部：官方 composer 复用（示意）+ chips */
  .dock { display: flex; flex-direction: column; gap: 10px; }
  .composer { background: #fff; border-radius: 20px; box-shadow: 0 18px 40px rgba(61,85,214,0.15), inset 0 0 0 1px rgba(77,107,254,0.14); padding: 12px 16px 8px; }
  .composer-row { display: flex; align-items: flex-end; gap: 12px; }
  .plus { width: 34px; height: 34px; border-radius: 10px; background: #f0f3fb; color: #5a6474; font-size: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ph { flex: 1; font-size: 14px; color: #aab2c4; padding: 6px 0 10px; line-height: 1.5; }
  .send { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, #4d6bfe, #3d55d6); display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 18px rgba(77,107,254,0.38); flex-shrink: 0; }
  .composer-controls { display: flex; align-items: center; gap: 10px; padding: 4px 2px 0; }
  .model-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 11px; border-radius: 999px; background: #f0f3fb; border: 1px solid rgba(77,107,254,0.16); font-size: 12px; color: #3d55d6; font-weight: 550; }
  .ctx { font-size: 11px; color: #98a1b3; margin-left: auto; }
  .reuse-note { font-size: 10.5px; color: #b3bacb; }
  .chips { display: flex; gap: 10px; justify-content: center; }
  .chip { padding: 6px 15px; border-radius: 999px; background: #fff; border: 1px solid rgba(77,107,254,0.22); font-size: 12.5px; color: #3d55d6; box-shadow: 0 3px 10px rgba(61,85,214,0.08); }
</style>
</head>
<body>
  <div class="dsh-rail">
    <div class="rail-logo">鱼</div>
    <div class="rail-item on"></div>
    <div class="rail-item"></div>
    <div class="rail-item"></div>
    <div class="rail-item"></div>
  </div>
  <div class="app">
    <div class="main">
      <div class="scene">
        <div class="header">
          <h1>下午好，</h1>
          <div class="avatar">🐋</div>
          <h1>大肥鱼管家</h1>
          <span class="pill-idle"><i></i>待命中</span>
          <span class="stat">正在看管 13 个对话</span>
        </div>
        <div class="window">
          <span class="cloud cloud-1"></span><span class="cloud cloud-2"></span><span class="cloud cloud-3"></span>
          <span class="sky"></span><span class="sky"></span><span class="sky"></span><span class="sky"></span>
          <span class="sky"></span><span class="sky"></span><span class="sky"></span>
          <span class="mullion-v"></span><span class="mullion-h"></span>
        </div>
        <div class="bubble">我是大肥鱼管家，就住在这条面板里：开个新对话、把问题接到已有对话、给某个对话收尾，直接吩咐。</div>
        <div class="whale"></div>
        <div class="floor"></div>
        <div class="floor-glow"></div>
      </div>
      <div class="board">
        <div class="board-title"><h2>对话看板</h2><span class="n">13 个对话</span></div>
        <div>
          <div class="sec-title">进行中 <span class="tag tag-run">运行中</span></div>
          <div class="row"><span class="t">ArrayList 扩容机制与 LinkedList 插入性能</span><span class="st st-run">运行中</span><span class="time">3 分钟前</span></div>
        </div>
        <div>
          <div class="sec-title">待确认 <span class="tag tag-wait">近 48h 活动</span></div>
          <div class="row"><span class="t">vas 资金方清算担保费凭证打分分配处理模式</span><span class="ck">✓</span><span class="time">2 小时前</span></div>
          <div class="row"><span class="t">vpc 日报数据文件</span><span class="ck">✓</span><span class="time">26 小时前</span></div>
        </div>
        <div>
          <div class="sec-title">已完成 <span class="tag tag-done">13</span></div>
          <div class="row"><span class="t">冒烟-勿用</span><span class="st st-ok">完成</span><span class="time">1 天前</span></div>
          <div class="row"><span class="t">deepseek-harness 插件骨架</span><span class="st st-ok">完成</span><span class="time">2 天前</span></div>
          <div class="more">展开全部 13 条 ∨</div>
        </div>
      </div>
    </div>
    <div class="dock">
      <div class="composer">
        <div class="composer-row">
          <span class="plus">＋</span>
          <span class="ph">吩咐大肥鱼…（回车发送 · Shift+回车换行）</span>
          <span class="send"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 8L14 2 9.5 14 7.5 9 1.5 8Z" fill="#fff"/></svg></span>
        </div>
        <div class="composer-controls">
          <span class="model-chip">⌄ deepseek-chat</span>
          <span class="reuse-note">↑ 复用官方 composer：模型选择 / 附件 / 命令菜单</span>
          <span class="ctx">上下文 12%</span>
        </div>
      </div>
      <div class="chips">
        <span class="chip">＋ 新开一个对话</span>
        <span class="chip">▶ 在跑什么？</span>
        <span class="chip">✎ 总结待确认的</span>
      </div>
    </div>
  </div>
</body>
</html>
`

await writeFile('design/mockup-v8.html', html)
console.log('written', html.length, 'chars')
// byClaude-end

// Contains claude-generated edits.
