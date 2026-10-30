// byClaude-start
// 设计稿 dafayu-prototype.html CSS 全量迁移：:root 变量并入 .dfy-root；宽度断点转容器查询；
// topbar/侧栏/rail 区块不迁移（宿主承担）；keyframes 加 dfy- 前缀防宿主冲突。
export const BOARD_CSS = `
.dfy-root{--bg:#eef2f9;--panel:rgba(255,255,255,.72);--panel2:rgba(255,255,255,.92);
--line:rgba(15,23,42,.08);--line2:rgba(15,23,42,.16);--txt:#131a2a;--sub:#5b6577;--faint:#8b93a5;
--c1:#0891b2;--c2:#7c3aed;--c3:#db2777;--ok:#059669;--warn:#d97706;--danger:#dc2626;
--shadow-card:0 24px 60px -18px rgba(15,23,42,.28),0 0 44px rgba(8,145,178,.14);
--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Segoe UI","Microsoft YaHei",sans-serif;
--mono:ui-monospace,"SF Mono","JetBrains Mono",Consolas,"Microsoft YaHei",monospace;
color-scheme:light;position:relative;height:100%;min-height:0;display:flex;flex-direction:column;
font-family:var(--font);font-size:14px;line-height:1.5;color:var(--txt);
background:radial-gradient(1200px 500px at 75% -10%,rgba(124,58,237,.10),transparent 60%),radial-gradient(900px 420px at 8% 108%,rgba(8,145,178,.10),transparent 60%),var(--bg);
overflow:hidden;container-type:inline-size;-webkit-font-smoothing:auto}
.dfy-root *,.dfy-root *::before,.dfy-root *::after{box-sizing:border-box}
.dfy-root h1,.dfy-root h2,.dfy-root h3,.dfy-root p,.dfy-root figure{margin:0}
.dfy-root ul,.dfy-root ol{list-style:none;margin:0;padding:0}
.dfy-root button{font-family:inherit;font-size:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0}
.dfy-root input{font-family:inherit}
.dfy-root .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.dfy-root .ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dfy-root .ic.sm{width:13px;height:13px}
.dfy-root .ic.xs{width:11px;height:11px}
.dfy-root :focus-visible{outline:2px solid var(--c1);outline-offset:2px;border-radius:6px}
/* 面板顶视图切换行（设计稿 topbar 的 view-switch 落位到面板内） */
.dfy-viewbar{display:flex;align-items:center;gap:10px;flex:none;padding:0 2px;z-index:2}
.dfy-viewbar .chip{margin-left:auto}
/* mood 三态轻量保留：work 环提速 / listen 光环亮 + 卡片倾身 */
.dfy-root .work-stage[data-mood="work"] .stage-ring{animation-duration:4s}
.dfy-root .work-stage[data-mood="listen"] .stage-halo{filter:brightness(1.45)}
.dfy-root .work-stage .stage-float{transition:transform .45s cubic-bezier(.22,.61,.36,1)}
.dfy-root .work-stage[data-mood="listen"] .stage-float{transform:rotate(-2deg) translateY(4px)}
.dfy-root .stage-hop .stage-float{animation:dfy-hop .32s cubic-bezier(.34,1.56,.64,1)}
@keyframes dfy-hop{0%,100%{translate:0 0}42%{translate:0 -8px}}
/* stage-card 容纳自绘精灵组件（设计稿为 img 220px） */
.dfy-root .stage-card{display:grid;place-items:center}
/* detail 浮层：官方完整对话铺满面板 */
.dfy-detail{position:absolute;inset:0;z-index:40;border-radius:14px;background:var(--panel2);border:1px solid var(--line);box-shadow:var(--shadow-card);overflow:hidden;display:flex;flex-direction:column;animation:dfy-detail-in .28s cubic-bezier(.22,.61,.36,1)}
@keyframes dfy-detail-in{from{opacity:0;translate:0 12px}}
.dfy-detail-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);font-size:13px;font-weight:600;color:var(--txt);flex:none}
.dfy-detail-close{margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:999px;border:1px solid var(--line2);background:transparent;color:var(--c1);font-size:12px;cursor:pointer;font-family:inherit}
.dfy-detail-close:hover{background:rgba(8,145,178,.08)}
.dfy-detail [data-conversation-content]{flex:1;min-height:0}
.dfy-detail [data-conversation-scroll] [data-composer-card]:has(~ [data-composer-card]){display:none!important}
.dfy-detail [class*="_card"]{max-width:100%!important;width:100%!important}
/* toasts（右下轻通知） */
.dfy-toasts{position:absolute;right:18px;bottom:56px;display:flex;flex-direction:column;gap:8px;z-index:50;pointer-events:none}
.dfy-toast{padding:8px 14px;border-radius:12px;background:var(--panel2);box-shadow:0 10px 28px rgba(15,23,42,.18),0 0 0 1px rgba(5,150,105,.35);color:var(--ok);font-size:12px;animation:dfy-toast-in .26s cubic-bezier(.34,1.56,.64,1);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@keyframes dfy-toast-in{from{opacity:0;translate:0 10px;scale:.94}}
/* reduced-motion 总闸 */
@media (prefers-reduced-motion:reduce){
.dfy-root *{animation:none!important;transition:none!important}
.dfy-root .stream{background:none;color:inherit;-webkit-text-fill-color:currentColor}
}
/* ===== 实现层补丁（设计稿为定宽进度，面板无真实进度数据时退化为流动条） ===== */
.dfy-root .t-bar.indet i,.dfy-root .s-bar.indet i{width:38%;animation:dfy-tbar-slide 1.4s ease-in-out infinite}
@keyframes dfy-tbar-slide{0%{margin-left:-38%}100%{margin-left:100%}}
/* mood 点色（设计稿只有 dot-ok 绿）：work 紫 / listen 青。 */
.dfy-root .dfy-dot-run{background:var(--c2)}
.dfy-root .dfy-dot-listen{background:var(--c1)}
/* panel-h 右侧「查看详细对话」入口（设计稿无对应物，官方完整对话的功能入口）。 */
.dfy-root .dfy-open-detail{display:inline-flex;align-items:center;gap:3px;color:var(--c1);font-size:11px;font-weight:500;border-radius:8px;padding:1px 6px}
.dfy-root .dfy-open-detail:hover{background:rgba(8,145,178,.08)}
/* 看板空分组 / 加载失败态。 */
.dfy-root .dfy-empty-row{padding:4px 10px;font-size:12px;color:var(--faint)}
.dfy-root .dfy-center-note{flex:1;display:grid;place-items:center;color:var(--faint);font-size:13px}

/* ===== 设计稿 dafayu-prototype CSS 全量迁移（scoped to .dfy-root） ===== */
/* ================= tokens & reset（token 已并入上方 .dfy-root 基座，此处勿再放规则） ================= */
.dfy-root button{font-family:inherit;font-size:inherit;color:inherit;background:none;border:none;cursor:pointer}
.dfy-root input{font-family:inherit}
.dfy-root ul, .dfy-root ol{list-style:none}
.dfy-root .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:.02em}
.dfy-root .ic{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dfy-root .ic.sm{width:13px;height:13px}
.dfy-root .ic.xs{width:11px;height:11px}
.dfy-root .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dfy-root :focus-visible{outline:2px solid var(--c1);outline-offset:2px;border-radius:6px}
/* ================= keyframes（横幅不得带 .dfy-root 前缀，否则吞掉下方 at-rule） ================= */
@keyframes dfy-sheen{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@keyframes dfy-drift{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(6%,-4%,0) scale(1.12)}100%{transform:translate3d(0,0,0) scale(1)}}
@keyframes dfy-drift2{0%{transform:translate3d(0,0,0) scale(1.08)}50%{transform:translate3d(-5%,5%,0) scale(.94)}100%{transform:translate3d(0,0,0) scale(1.08)}}
@keyframes dfy-breathe{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.045);opacity:1}}
@keyframes dfy-spin{to{transform:rotate(360deg)}}
@keyframes dfy-caret{0%,45%{opacity:1}50%,100%{opacity:0}}
@keyframes dfy-pulse{0%,100%{box-shadow:0 0 0 0 rgba(5,150,105,.45)}70%{box-shadow:0 0 0 6px rgba(5,150,105,0)}}
@keyframes dfy-amberpulse{0%,100%{box-shadow:0 0 0 0 rgba(217,119,6,.5)}70%{box-shadow:0 0 0 5px rgba(217,119,6,0)}}
@keyframes dfy-wave{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@keyframes dfy-barflow{0%{background-position:0% 0}100%{background-position:200% 0}}
@keyframes dfy-floatcard{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes dfy-floaty{0%{transform:translateY(0);opacity:0}12%{opacity:.8}100%{transform:translateY(-46px);opacity:0}}
@keyframes dfy-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes dfy-fadeout{to{opacity:0;transform:scale(.96)}}
@keyframes dfy-orbit{to{transform:rotate(360deg)}}
/* ================= app frame（.app 容器由宿主承担，两层底光已并入 .dfy-root 背景） ================= */
.dfy-root .aurora{position:absolute;inset:0;pointer-events:none;filter:blur(80px);opacity:.75}
.dfy-root .dfy-deco{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden}
.dfy-root .dfy-deco .dd{position:absolute;bottom:-30px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(8,145,178,.5));animation:dfy-deco-rise linear infinite}
.dfy-root .dfy-deco .dd.p{background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(124,58,237,.5))}
.dfy-root .dfy-deco .dd.k{background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(219,39,119,.45))}
.dfy-root .dfy-deco .dd.h{background:rgba(8,145,178,.06);border:1px solid rgba(8,145,178,.4);box-shadow:inset -2px -2px 4px rgba(255,255,255,.55)}
.dfy-root .dfy-deco .d1{left:6%;width:10px;height:10px;animation-duration:18s}
.dfy-root .dfy-deco .d2{left:16%;width:7px;height:7px;animation-duration:24s;animation-delay:6s}
.dfy-root .dfy-deco .d3{left:28%;width:13px;height:13px;animation-duration:20s;animation-delay:12s}
.dfy-root .dfy-deco .d4{left:42%;width:8px;height:8px;animation-duration:26s;animation-delay:3s}
.dfy-root .dfy-deco .d5{left:55%;width:11px;height:11px;animation-duration:22s;animation-delay:9s}
.dfy-root .dfy-deco .d6{left:67%;width:6px;height:6px;animation-duration:19s;animation-delay:15s}
.dfy-root .dfy-deco .d7{left:78%;width:12px;height:12px;animation-duration:25s;animation-delay:5s}
.dfy-root .dfy-deco .d8{left:88%;width:8px;height:8px;animation-duration:21s;animation-delay:11s}
.dfy-root .dfy-deco .d9{left:95%;width:6px;height:6px;animation-duration:23s;animation-delay:17s}
.dfy-root .dfy-deco .d10{left:10%;width:12px;height:12px;animation-duration:21s;animation-delay:2s}
.dfy-root .dfy-deco .d11{left:22%;width:5px;height:5px;animation-duration:27s;animation-delay:8s}
.dfy-root .dfy-deco .d12{left:33%;width:9px;height:9px;animation-duration:23s;animation-delay:14s}
.dfy-root .dfy-deco .d13{left:47%;width:6px;height:6px;animation-duration:25s;animation-delay:6s}
.dfy-root .dfy-deco .d14{left:58%;width:14px;height:14px;animation-duration:19s;animation-delay:12s}
.dfy-root .dfy-deco .d15{left:72%;width:7px;height:7px;animation-duration:22s;animation-delay:16s}
.dfy-root .dfy-deco .d16{left:84%;width:10px;height:10px;animation-duration:24s;animation-delay:4s}
@keyframes dfy-deco-rise{0%{transform:translateY(0);opacity:0}6%{opacity:.85}88%{opacity:.75}100%{transform:translateY(-880px);opacity:0}}
.dfy-root .dfy-deco .df{position:absolute;left:0;display:block;animation:dfy-deco-swim linear infinite}
.dfy-root .dfy-deco .df .ic{width:100%;height:100%}
.dfy-root .dfy-deco .dfi{display:block;animation:dfy-floatcard 5.5s ease-in-out infinite}
.dfy-root .dfy-deco .f1{width:24px;height:24px;top:60%;color:var(--c1);opacity:.24;animation-duration:28s}
.dfy-root .dfy-deco .f2{width:14px;height:14px;top:32%;color:var(--c2);opacity:.22;animation-duration:38s;animation-delay:13s}
@keyframes dfy-deco-swim{0%{transform:translateX(-80px)}100%{transform:translateX(1420px)}}
.dfy-root .dfy-deco .dg{position:absolute;bottom:-4px;display:flex;align-items:flex-end;gap:3px;transform-origin:50% 100%;animation:dfy-deco-sway ease-in-out infinite}
.dfy-root .dfy-deco .dg i{display:block;width:9px;border-radius:50% 50% 45% 45%/85% 85% 20% 20%;background:linear-gradient(180deg,transparent,rgba(8,145,178,.3))}
.dfy-root .dfy-deco .dg i:nth-child(1){height:52px;transform:rotate(-13deg)}
.dfy-root .dfy-deco .dg i:nth-child(2){height:68px}
.dfy-root .dfy-deco .dg i:nth-child(3){height:46px;transform:rotate(11deg)}
.dfy-root .dfy-deco .g1{left:2%;animation-duration:9s}
.dfy-root .dfy-deco .g2{right:3%;animation-duration:11s;animation-delay:2s}
.dfy-root .dfy-deco .g2 i{background:linear-gradient(180deg,transparent,rgba(124,58,237,.26))}
@keyframes dfy-deco-sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
.dfy-root .aurora i{position:absolute;border-radius:50%}
.dfy-root .aurora .a1{width:520px;height:340px;left:38%;top:-160px;background:radial-gradient(closest-side,rgba(124,58,237,.16),transparent 70%);animation:dfy-drift 12s ease-in-out infinite}
.dfy-root .aurora .a2{width:470px;height:320px;left:-130px;bottom:-70px;background:radial-gradient(closest-side,rgba(8,145,178,.12),transparent 70%);animation:dfy-drift2 15s ease-in-out infinite}
.dfy-root .aurora .a3{width:380px;height:280px;right:-100px;top:32%;background:radial-gradient(closest-side,rgba(219,39,119,.10),transparent 70%);animation:dfy-drift 18s ease-in-out infinite}
.dfy-root .view-switch{display:flex;gap:4px;padding:4px;border-radius:12px;background:rgba(15,23,42,.05);border:1px solid var(--line)}
.dfy-root .vs-btn{padding:5px 14px;border-radius:9px;font-size:12.5px;font-weight:500;color:var(--sub);transition:.18s;display:inline-flex;align-items:center;gap:6px}
.dfy-root .vs-btn:hover{color:var(--txt)}
.dfy-root .vs-btn.active{background:#fff;color:var(--txt);box-shadow:0 2px 8px rgba(15,23,42,.12)}
.dfy-root .vs-btn .ic{width:13px;height:13px}
.dfy-root .top-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.dfy-root .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--sub);border:1px solid var(--line);border-radius:999px;padding:4px 11px;background:rgba(255,255,255,.7)}
.dfy-root .chip-ok{color:#047857;background:rgba(5,150,105,.08);border-color:rgba(5,150,105,.3)}
.dfy-root .dot{width:7px;height:7px;border-radius:50%;flex:none}
.dfy-root .dot-ok{background:var(--ok);animation:dfy-pulse 2.4s infinite}
.dfy-root /* ================= shared atoms ================= */
.panel-h{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;letter-spacing:.12em;color:var(--faint);padding:0 2px}
.dfy-root .panel-h .ic{width:13px;height:13px;color:var(--c1)}
.dfy-root .spinner{width:12px;height:12px;border-radius:50%;background:conic-gradient(from 0deg,transparent 30%,currentColor);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2.4px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 2.4px),#000 0);animation:dfy-spin .9s linear infinite;flex:none;display:inline-block}
.dfy-root .grad{background:linear-gradient(92deg,var(--c1),var(--c2) 45%,var(--c3));background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dfy-sheen 4.5s linear infinite}
.dfy-root .removing{animation:dfy-fadeout .26s ease forwards}
.dfy-root /* ---- chat messages (both views) ---- */
.msgs{display:flex;flex-direction:column;gap:10px;min-height:0}
.dfy-root .msg{display:flex;gap:10px;align-items:flex-end;animation:dfy-rise .35s ease both}
.dfy-root .msg.user{flex-direction:row-reverse}
.dfy-root .msg .ava{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;font-weight:600;overflow:hidden}
.dfy-root .msg.user .ava{background:rgba(15,23,42,.06);border:1px solid var(--line2);color:var(--sub)}
.dfy-root .msg.ai .ava{border:1px solid rgba(8,145,178,.5);box-shadow:0 0 12px rgba(8,145,178,.25);background:#fff}
.dfy-root .msg.ai .ava img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;object-position:50% 22%}
.dfy-root .msg .ava > span{width:100%;height:100%;display:block}
.dfy-root .msg.user .ava img.dfy-user-avatar{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}
.dfy-root .bubble{max-width:85%;padding:9px 13px;border-radius:15px;font-size:13px;overflow-wrap:break-word}
.dfy-root .msg.user .bubble{background:rgba(15,23,42,.05);border:1px solid var(--line2);border-bottom-right-radius:5px;color:var(--txt)}
.dfy-root .msg.ai .bubble{background:linear-gradient(150deg,rgba(8,145,178,.06),rgba(124,58,237,.05));border:1px solid rgba(8,145,178,.3);border-bottom-left-radius:5px;box-shadow:0 0 24px rgba(8,145,178,.08)}
.dfy-root .stream{background:linear-gradient(92deg,var(--sub) 0 40%,var(--c1) 50%,var(--sub) 60% 100%);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dfy-sheen 3s linear infinite}
.dfy-root .caret{display:inline-block;width:6px;height:13px;margin-left:3px;border-radius:2px;background:var(--c1);vertical-align:-2px;animation:dfy-caret 1s steps(1) infinite}
.dfy-root .meta{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}
.dfy-root .wave{display:inline-flex;align-items:center;gap:2.5px;height:14px}
.dfy-root .wave i{width:3px;border-radius:2px;background:linear-gradient(180deg,var(--c1),var(--c2));animation:dfy-wave 1s ease-in-out infinite}
.dfy-root /* byClaude-start ---- bubble markdown（完整 Markdown 渲染的紧凑排版；作用域钉在 .bubble.md 内）（byClaude） ---- */
.dfy-root .bubble.md>:first-child{margin-top:0!important}
.dfy-root .bubble.md>:last-child{margin-bottom:0!important}
.dfy-root .bubble.md p{margin:6px 0;line-height:1.6}
.dfy-root .bubble.md h1,.dfy-root .bubble.md h2,.dfy-root .bubble.md h3,.dfy-root .bubble.md h4,.dfy-root .bubble.md h5,.dfy-root .bubble.md h6{margin:10px 0 4px;font-size:13.5px;font-weight:700;line-height:1.45;color:var(--txt)}
.dfy-root .bubble.md ul,.dfy-root .bubble.md ol{margin:6px 0;padding-left:20px;display:flex;flex-direction:column;gap:3px}
.dfy-root .bubble.md li>p{margin:0}
.dfy-root .bubble.md code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;background:rgba(15,23,42,.07);border:1px solid var(--line2);border-radius:5px;padding:1px 5px;overflow-wrap:anywhere}
.dfy-root .bubble.md pre{margin:8px 0;padding:10px 12px;background:rgba(15,23,42,.92);border-radius:10px;overflow-x:auto;max-width:100%}
.dfy-root .bubble.md pre code{background:none;border:none;padding:0;color:#e2e8f0;line-height:1.6;overflow-wrap:normal}
.dfy-root .bubble.md blockquote{margin:8px 0;padding:2px 10px;border-left:3px solid rgba(8,145,178,.55);color:var(--sub)}
.dfy-root .bubble.md blockquote p{margin:4px 0}
.dfy-root .bubble.md a{color:var(--c1);text-decoration:none;border-bottom:1px dashed rgba(8,145,178,.5)}
.dfy-root .bubble.md hr{border:none;border-top:1px solid var(--line2);margin:10px 0}
.dfy-root .bubble.md table{border-collapse:collapse;margin:8px 0;font-size:12px;display:block;max-width:100%;overflow-x:auto}
.dfy-root .bubble.md th,.dfy-root .bubble.md td{border:1px solid var(--line2);padding:4px 8px;text-align:left}
.dfy-root .bubble.md th{background:rgba(15,23,42,.05);font-weight:600}
.dfy-root .bubble.md img{max-width:100%;border-radius:8px}
.dfy-root .bubble.md.streaming,.dfy-root .bubble.md.streaming h1,.dfy-root .bubble.md.streaming h2,.dfy-root .bubble.md.streaming h3,.dfy-root .bubble.md.streaming h4,.dfy-root .bubble.md.streaming h5,.dfy-root .bubble.md.streaming h6{color:var(--sub)}
/* byClaude-end */
.dfy-root /* ---- task cards ---- */
.flow-label{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.1em;color:var(--sub);margin-top:4px}
.dfy-root .gdot{width:7px;height:7px;border-radius:50%;flex:none}
.dfy-root .gdot.cyan{background:var(--c1);box-shadow:0 0 10px rgba(8,145,178,.6)}
.dfy-root .gdot.amber{background:var(--warn);animation:dfy-amberpulse 2.2s infinite}
.dfy-root .gdot.green{background:var(--ok)}
.dfy-root .tcard{position:relative;border-radius:14px;background:var(--panel2);border:1px solid var(--line);padding:11px 12px;transition:.25s;animation:dfy-rise .35s ease both}
.dfy-root .tcard:hover{border-color:var(--line2);transform:translateY(-2px);box-shadow:0 14px 30px -12px rgba(15,23,42,.28)}
.dfy-root .tcard.live{border-color:rgba(8,145,178,.4);background:linear-gradient(150deg,rgba(8,145,178,.06),rgba(124,58,237,.05))}
.dfy-root .tcard.live::before{content:"";position:absolute;inset:-1px;border-radius:15px;padding:1px;background:linear-gradient(120deg,rgba(8,145,178,.5),rgba(124,58,237,.3),rgba(8,145,178,.5));background-size:250% 250%;animation:dfy-sheen 4s linear infinite;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.dfy-root .t-top{display:flex;align-items:center;gap:9px}
.dfy-root .t-ico{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none;border:1px solid var(--line2);background:rgba(255,255,255,.8)}
.dfy-root .t-ico .ic{width:14px;height:14px}
.dfy-root .t-ico.cyan{color:var(--c1)}
.dfy-root .t-ico.amber{color:var(--warn)}
.dfy-root .t-ico.green{color:var(--ok)}
.dfy-root .t-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:7px;min-width:0;flex-wrap:wrap}
.dfy-root .live-chip{font-family:var(--mono);font-size:9px;letter-spacing:.12em;color:var(--c1);border:1px solid rgba(8,145,178,.5);border-radius:5px;padding:1px 5px;display:inline-flex;align-items:center;gap:4px}
.dfy-root .live-chip::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--c1);animation:dfy-pulse 1.6s infinite}
.dfy-root .t-time{margin-left:auto;font-size:10.5px;color:var(--faint)}
.dfy-root .t-desc{font-size:11.5px;color:var(--sub);margin:7px 0 0 37px}
.dfy-root .t-steps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:9px 0 0 37px}
.dfy-root .st{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;border-radius:7px;padding:3px 8px;border:1px solid var(--line)}
.dfy-root .st .ic{width:10px;height:10px}
.dfy-root .st.done{color:var(--ok);border-color:rgba(5,150,105,.3);background:rgba(5,150,105,.06)}
.dfy-root .st.cur{color:var(--c1);border-color:rgba(8,145,178,.4);background:rgba(8,145,178,.06)}
.dfy-root .t-bar{height:5px;border-radius:99px;background:rgba(15,23,42,.08);margin:10px 0 0 37px;overflow:hidden}
.dfy-root .t-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--c1),var(--c2),var(--c1));background-size:200% 100%;animation:dfy-barflow 2.2s linear infinite;box-shadow:0 0 12px rgba(8,145,178,.35);transition:width 1.4s ease}
.dfy-root .t-acts{display:flex;gap:8px;margin:10px 0 0 37px}
.dfy-root .mini{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;border-radius:8px;padding:4.5px 12px;border:1px solid var(--line2);background:#fff;transition:.18s}
.dfy-root .mini .ic{width:11px;height:11px}
.dfy-root .mini.ok{color:var(--ok);border-color:rgba(5,150,105,.45);background:rgba(5,150,105,.08)}
.dfy-root .mini.ok:hover{background:rgba(5,150,105,.16)}
.dfy-root .mini.no{color:var(--sub)}
.dfy-root .mini.no:hover{border-color:rgba(220,38,38,.45);color:var(--danger)}
.dfy-root .done-tag{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--ok)}
.dfy-root .done-tag .ic{width:11px;height:11px}
.dfy-root .done-sum{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 12px;border-radius:12px;border:1px dashed var(--line);font-size:11px;color:var(--sub)}
.dfy-root .done-sum .ic{width:12px;height:12px;color:var(--ok)}
.dfy-root .done-sum b{color:var(--ok);font-weight:600}
.dfy-root .dchip{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--ok);border:1px solid rgba(5,150,105,.3);background:rgba(5,150,105,.06);border-radius:999px;padding:2.5px 9px;animation:dfy-rise .3s ease both}
.dfy-root .dchip .ic{width:11px;height:11px}
.dfy-root /* ---- big input (both views) ---- */
.ask-box{display:flex;align-items:center;gap:10px;padding:9px 10px 9px 16px;border-radius:16px;background:rgba(255,255,255,.85);border:1px solid var(--line2);backdrop-filter:blur(10px);transition:.25s;box-shadow:0 14px 40px -18px rgba(15,23,42,.22)}
.dfy-root .ask-box:focus-within{border-color:rgba(8,145,178,.6);box-shadow:0 0 0 3px rgba(8,145,178,.12),0 0 34px rgba(8,145,178,.14)}
.dfy-root .ask-box input{flex:1;min-width:0;height:34px;background:none;border:none;outline:none;color:var(--txt);font-size:14px;padding:0}
.dfy-root .ask-box input::placeholder{color:var(--faint)}
.dfy-root .ask-tools{display:flex;align-items:center;gap:8px;flex:none}
.dfy-root .ask-tools .sp{display:none}
/* byClaude-start 模型/思考深度选择器（替代原装饰 model-pill）（byClaude） */
.dfy-root .mpick-wrap{position:relative;flex:none}
.dfy-root .mpick{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--sub);border:1px solid var(--line);border-radius:999px;padding:5px 11px;background:rgba(255,255,255,.7);transition:.18s;max-width:190px;cursor:pointer}
.dfy-root .mpick:hover{border-color:rgba(8,145,178,.5);color:var(--txt)}
.dfy-root .mpick .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfy-root .mpick .ic.sm{width:12px;height:12px;opacity:.7;color:var(--c1);flex:none}
.dfy-root .mpick .ic.xs{width:10px;height:10px;opacity:.55;flex:none;transition:transform .18s}
.dfy-root .mpick[aria-expanded="true"] .ic.xs{transform:rotate(180deg)}
.dfy-root .mpick-menu{position:absolute;bottom:calc(100% + 10px);left:0;min-width:230px;max-height:280px;overflow-y:auto;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 46px -14px rgba(15,23,42,.3);padding:6px;z-index:60;animation:dfy-rise .22s ease both}
.dfy-root .mpick-group{font-size:10px;letter-spacing:.1em;color:var(--faint);padding:7px 10px 3px;font-weight:600;text-transform:uppercase}
.dfy-root .mpick-item{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;border-radius:9px;padding:7px 10px;transition:.15s;cursor:pointer}
.dfy-root .mpick-item:hover{background:rgba(8,145,178,.07)}
.dfy-root .mpick-item.on{background:rgba(8,145,178,.1)}
.dfy-root .mpick-item .mpick-name{font-size:12.5px;color:var(--txt)}
.dfy-root .mpick-item.on .mpick-name{color:var(--c1);font-weight:600}
.dfy-root .mpick-item .mpick-sub{font-size:10.5px;color:var(--faint)}
/* byClaude-end */
.dfy-root .send{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#22d3ee,#8b5cf6);box-shadow:0 4px 18px rgba(8,145,178,.35);transition:.2s;flex:none;animation:dfy-send-glow 3.2s ease-in-out infinite}
@keyframes dfy-send-glow{0%,100%{box-shadow:0 4px 18px rgba(8,145,178,.35)}50%{box-shadow:0 6px 26px rgba(139,92,246,.55)}}
.dfy-root .send:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(8,145,178,.5)}
.dfy-root .send:active{transform:translateY(0)}
.dfy-root .hint-row{display:flex;gap:14px;margin-top:8px;font-size:10.5px;color:var(--faint);flex-wrap:wrap}
.dfy-root .hint-row kbd{font-family:var(--mono);border:1px solid var(--line2);border-radius:4px;padding:0 4px;background:#fff}
/* ---- toasts：实际使用基座区 .dfy-toasts/.dfy-toast，设计稿版 .toasts 未迁移 ---- */
.dfy-root /* ================= VIEW A · 工作台 ================= */
.view{flex:1;min-height:0;display:grid}
.dfy-root #view-workbench{grid-template-columns:1fr}
.dfy-root #view-workbench[hidden]{display:none}
.dfy-root .wb-main{position:relative;z-index:2;display:flex;flex-direction:column;min-height:0;min-width:0;padding:14px 26px 12px;overflow:hidden}
.dfy-root .greet-row{display:flex;align-items:center;gap:12px;flex:none}
.dfy-root .greet{font-size:21px;font-weight:600;letter-spacing:.01em}
.dfy-root .v1-work{flex:1;min-height:0;margin-top:12px;display:flex;gap:14px;align-items:stretch}
.dfy-root .work-chat, .dfy-root .work-tasks{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border-radius:18px;background:var(--panel);border:1px solid var(--line);backdrop-filter:blur(12px)}
.dfy-root .work-chat{flex:1.5}
.dfy-root .work-tasks{flex:1}
.dfy-root .chat-body{flex:1;min-height:0;display:flex;gap:14px}
.dfy-root /* 3D character stage */
.work-stage{position:relative;flex:none;width:212px;padding-bottom:30px;perspective:1100px}
.dfy-root .stage-halo{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);width:330px;height:300px;border-radius:50%;background:radial-gradient(closest-side,rgba(8,145,178,.16),rgba(124,58,237,.10) 55%,transparent 72%);filter:blur(8px);animation:dfy-breathe 4.6s ease-in-out infinite;pointer-events:none}
.dfy-root .stage-ring{position:absolute;left:50%;top:46%;width:272px;height:272px;transform:translate(-50%,-50%);border-radius:50%;padding:1.5px;background:conic-gradient(from 90deg,rgba(8,145,178,0),rgba(8,145,178,.5),rgba(124,58,237,.55),rgba(219,39,119,.3),rgba(8,145,178,0));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:dfy-orbit 11s linear infinite;pointer-events:none;opacity:.5}
.dfy-root .stage-float{height:calc(100% - 30px);animation:dfy-floatcard 6.5s ease-in-out infinite;transform-style:preserve-3d}
.dfy-root .stage-card{position:relative;z-index:2;height:100%;width:max-content;margin:0 auto;padding:9px;border-radius:20px;background:linear-gradient(165deg,rgba(255,255,255,.88),rgba(255,255,255,.6));border:1px solid rgba(124,58,237,.22);box-shadow:var(--shadow-card),0 34px 70px -22px rgba(124,58,237,.20);backdrop-filter:blur(4px);transform:rotateY(-12deg) rotateX(4deg);transform-style:preserve-3d;transition:transform .18s ease-out}
.dfy-root .stage-card::before{content:"";position:absolute;inset:0;border-radius:19px;padding:1px;background:linear-gradient(155deg,rgba(8,145,178,.55),rgba(124,58,237,.42) 50%,rgba(8,145,178,.18));background-size:220% 220%;animation:dfy-sheen 5.5s linear infinite;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.dfy-root .stage-card::after{content:"";position:absolute;inset:0;border-radius:19px;background:linear-gradient(115deg,transparent 32%,rgba(255,255,255,.5) 45%,rgba(8,145,178,.12) 55%,transparent 70%);background-size:260% 260%;background-position:var(--sheen,30% 30%);mix-blend-mode:screen;pointer-events:none}
.dfy-root .stage-card img{display:block;height:100%;width:auto;border-radius:13px;filter:saturate(1.06);transform:translateZ(26px);user-select:none;-webkit-user-drag:none}
.dfy-root .stage-card .dfy-pet{--dfy-hero-size:186px}
.dfy-root .stage-shadow{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);width:190px;height:24px;border-radius:50%;background:radial-gradient(closest-side,rgba(15,23,42,.22),transparent 70%);filter:blur(5px)}
.dfy-root .stage-cap{position:absolute;left:50%;bottom:0;transform:translateX(-50%);z-index:3;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--sub);background:rgba(255,255,255,.78);border:1px solid var(--line);border-radius:999px;padding:4px 12px;backdrop-filter:blur(6px);width:max-content;white-space:nowrap}
.dfy-root .bub{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(8,145,178,.35));animation:dfy-floaty 5.5s ease-in infinite;pointer-events:none;z-index:1}
.dfy-root .bub.b1{width:8px;height:8px;right:-2px;top:22%;animation-delay:.4s}
.dfy-root .bub.b2{width:5px;height:5px;right:10px;top:34%;animation-delay:2.2s}
.dfy-root .bub.b3{width:6px;height:6px;right:-8px;top:46%;animation-delay:3.4s}
/* 精灵头顶短语泡泡（待机随机冒出）与状态栏「在跑」图标跳动。 */
.dfy-root .stage-say{position:absolute;right:-10px;top:10%;z-index:4;max-width:130px;padding:6px 11px;border-radius:12px;background:rgba(255,255,255,.92);border:1px solid rgba(8,145,178,.35);color:#0e7490;font-size:11.5px;font-weight:500;white-space:nowrap;box-shadow:0 8px 22px -8px rgba(15,23,42,.25);animation:dfy-rise .3s cubic-bezier(.34,1.56,.64,1) both}
.dfy-root .dfy-plug-run .ic{animation:dfy-plug-bounce 1.1s ease-in-out infinite}
@keyframes dfy-plug-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
.dfy-root .chat-body > .msgs{flex:1;min-width:0;overflow-y:auto;padding-right:4px}
.dfy-root .chat-body > .msgs::-webkit-scrollbar, .dfy-root .flow-scroll::-webkit-scrollbar{width:8px}
.dfy-root .chat-body > .msgs::-webkit-scrollbar-thumb, .dfy-root .flow-scroll::-webkit-scrollbar-thumb{background:rgba(15,23,42,.15);border-radius:99px}
.dfy-root .flow-scroll{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:9px;padding-right:4px}
.dfy-root .work-tasks .done-sum{margin-top:auto;flex:none}
.dfy-root .quick{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;flex:none}
.dfy-root .qchip{display:flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;font-size:12.5px;background:var(--panel2);border:1px solid var(--line);transition:.2s}
.dfy-root .qchip .ic{width:14px;height:14px;color:var(--c1);transition:transform .2s}
.dfy-root .qchip:hover .ic{transform:scale(1.18) rotate(-6deg)}
.dfy-root .qchip:hover{border-color:rgba(8,145,178,.6);box-shadow:0 0 20px rgba(8,145,178,.15);transform:translateY(-2px)}
.dfy-root .wb .ask-box{margin-top:12px;flex:none}
.dfy-root .statusbar{display:flex;align-items:center;gap:14px;padding:8px 6px 2px;font-size:11px;color:var(--faint);flex:none;flex-wrap:wrap}
.dfy-root .statusbar .sti{display:flex;align-items:center;gap:6px}
.dfy-root .statusbar .sti.ok{color:var(--ok)}
.dfy-root .statusbar .ic{width:12px;height:12px}
.dfy-root .statusbar .sep{width:3px;height:3px;border-radius:50%;background:var(--line2)}
.dfy-root /* ================= VIEW B · 控制台 ================= */
#view-console{grid-template-columns:1fr}
.dfy-root #view-console[hidden]{display:none}
.dfy-root .cs-main{position:relative;z-index:2;display:flex;flex-direction:column;min-height:0;min-width:0;padding:14px 26px 14px;overflow:hidden}
.dfy-root .hero{display:flex;align-items:center;gap:14px;padding:11px 16px;border-radius:16px;background:var(--panel);border:1px solid var(--line);box-shadow:0 10px 30px -14px rgba(15,23,42,.18);backdrop-filter:blur(12px);perspective:700px;flex:none}
/* byClaude-start hero 横幅与对话面板头：点击跳原生对话页（byClaude） */
.dfy-root .hero.clickable{cursor:pointer;transition:border-color .2s,box-shadow .2s}
.dfy-root .hero.clickable:hover,.dfy-root .hero.clickable:focus-visible{border-color:rgba(8,145,178,.5);box-shadow:0 10px 30px -14px rgba(15,23,42,.18),0 0 0 3px rgba(8,145,178,.1)}
.dfy-root .panel-h.clickable{cursor:pointer;transition:color .18s}
.dfy-root .panel-h.clickable:hover{color:var(--c1)}
/* byClaude-end */
.dfy-root .hero-orb{position:relative;width:52px;height:52px;border-radius:50%;overflow:hidden;display:grid;place-items:center;border:1px solid rgba(124,58,237,.25);animation:dfy-breathe 4.5s ease-in-out infinite;transform:rotateY(-10deg);transform-style:preserve-3d;flex:none}
.dfy-root .hero-orb img{width:100%;height:100%;object-fit:cover;display:block;object-position:50% 22%;transform:translateZ(16px)}
.dfy-root .hero-mid{min-width:0;flex:1}
.dfy-root .hero-label{display:flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.1em;color:var(--faint);font-weight:600}
.dfy-root .hero-label .ic{width:12px;height:12px;color:var(--c1)}
.dfy-root .thought{font-size:13.5px;font-weight:500;margin-top:3px;min-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfy-root .hero-timer{text-align:right;flex:none}
.dfy-root .hero-timer .t{font-family:var(--mono);font-size:19px;font-weight:500}
.dfy-root .hero-timer small{display:block;font-size:10px;color:var(--faint);letter-spacing:.08em}
.dfy-root .cs-body{flex:1;min-height:0;display:flex;gap:14px;margin-top:12px}
.dfy-root .chat-panel, .dfy-root .flow-panel{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border-radius:18px;background:var(--panel);border:1px solid var(--line);backdrop-filter:blur(12px)}
.dfy-root .chat-panel{flex:1}
.dfy-root .flow-panel{flex:1.15}
.dfy-root .chat-panel .msgs{flex:1;min-height:0;overflow-y:auto;padding-right:4px}
.dfy-root .chat-panel .msgs::-webkit-scrollbar{width:8px}
.dfy-root .chat-panel .msgs::-webkit-scrollbar-thumb{background:rgba(15,23,42,.15);border-radius:99px}
.dfy-root .flow{position:relative;display:flex;flex-direction:column;gap:8px}
.dfy-root .flow::before{content:"";position:absolute;left:16px;top:16px;bottom:16px;width:2px;background:linear-gradient(180deg,rgba(5,150,105,.35),rgba(8,145,178,.4) 55%,rgba(15,23,42,.08))}
.dfy-root .step{position:relative;display:flex;gap:12px;padding:9px 12px;border-radius:14px;transition:.2s;animation:dfy-rise .35s ease both}
.dfy-root .step:hover{background:rgba(255,255,255,.65)}
.dfy-root .s-ico{position:relative;z-index:2;width:32px;height:32px;border-radius:11px;display:grid;place-items:center;flex:none;border:1px solid var(--line2);background:#fff;box-shadow:0 4px 12px -4px rgba(15,23,42,.15)}
.dfy-root .s-ico .ic{width:15px;height:15px}
.dfy-root .step.done .s-ico{color:var(--ok);border-color:rgba(5,150,105,.35)}
.dfy-root .step.live .s-ico{color:var(--c1);border-color:rgba(8,145,178,.45);box-shadow:0 0 0 4px rgba(8,145,178,.1),0 4px 14px -4px rgba(8,145,178,.3)}
.dfy-root .step.wait .s-ico{color:var(--warn);border-color:rgba(217,119,6,.4)}
.dfy-root .step.queue .s-ico{color:var(--faint)}
.dfy-root .s-body{min-width:0;flex:1}
.dfy-root .s-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dfy-root .s-h b{font-size:13px;font-weight:600}
.dfy-root .s-h .mono{font-size:10px;color:var(--faint)}
.dfy-root .s-tag{font-size:9.5px;letter-spacing:.1em;font-weight:600;border-radius:5px;padding:1.5px 6px}
.dfy-root .step.live .s-tag{color:var(--c1);background:rgba(8,145,178,.1);border:1px solid rgba(8,145,178,.3)}
.dfy-root .step.wait .s-tag{color:var(--warn);background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.3);animation:dfy-amberpulse 2.4s infinite}
.dfy-root .step.done .s-tag{color:var(--ok);background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.25)}
.dfy-root .step.queue .s-tag{color:var(--faint);background:rgba(15,23,42,.05);border:1px solid var(--line)}
.dfy-root .s-p{font-size:11.5px;color:var(--sub);margin-top:3px}
.dfy-root .s-p .stream{background:linear-gradient(92deg,var(--sub) 0 40%,var(--c1) 50%,var(--sub) 60% 100%);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dfy-sheen 3s linear infinite}
.dfy-root .s-bar{height:5px;border-radius:99px;background:rgba(15,23,42,.08);margin-top:8px;max-width:340px;overflow:hidden}
.dfy-root .s-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#22d3ee,#8b5cf6,#22d3ee);background-size:200% 100%;animation:dfy-barflow 2.2s linear infinite;transition:width 1.4s ease}
.dfy-root .s-acts{display:flex;gap:8px;margin-top:8px}
.dfy-root .step.wait{background:rgba(251,191,36,.07);border:1px dashed rgba(217,119,6,.35)}
.dfy-root .step.live{background:var(--panel2);border:1px solid rgba(8,145,178,.25);box-shadow:0 12px 30px -16px rgba(8,145,178,.35)}
.dfy-root .cs .ask-box{margin-top:12px;flex:none}
/* ================= responsive（横幅不得带 .dfy-root 前缀，否则 @media 被整体吞掉） ================= */
@media (max-width:1180px){
  .dfy-root .wb .work-stage{display:none}
}
@container (max-width:920px){.dfy-root #view-workbench, .dfy-root #view-console{grid-template-columns:1fr}.dfy-root .chat-body .work-stage{display:none}}
@container (max-width:760px){.dfy-root .v1-work, .dfy-root .cs-body{flex-direction:column;overflow-y:auto}.dfy-root .work-chat, .dfy-root .work-tasks, .dfy-root .chat-panel, .dfy-root .flow-panel{flex:none}.dfy-root .work-chat{min-height:380px}}
/* byClaude-start 矮屏统一改「内容区内部滚」（与 760 容器断点同构）：整体滚动会把
   输入条卷进折叠区推出面板外（实测工作台/控制台 bottom 均超容器 500px+），
   输入条必须常驻底部（byClaude） */
@media (max-height:700px){
.dfy-root .v1-work{overflow-y:auto}
.dfy-root .work-chat, .dfy-root .work-tasks{flex:none}
.dfy-root .work-chat{min-height:420px}
.dfy-root .cs-body{overflow-y:auto}
.dfy-root .chat-panel, .dfy-root .flow-panel{flex:none}
.dfy-root .chat-panel .msgs{min-height:280px}}`
// byClaude-end
// byClaude-end

// Contains claude-generated edits.
