/**
 * 大肥鱼管家的人形拟人形象：鲸鱼娘精灵图帧动画（素材取自 dsh-web-ui 的 dsh-pet，
 * 见 whaleSprite.ts 头注）。待机播 idle 行，思考中播 running 行（工作姿态）并顶出
 * 思考气泡；帧切换按轨道时长逐帧推进，reduced-motion 时停在第 0 帧。
 * byClaude
 */
// byClaude-start
import { useEffect, useState, type CSSProperties } from 'react'
import {
  WHALE_FRAME_HEIGHT, WHALE_FRAME_WIDTH, WHALE_SPRITE_COLS, WHALE_SPRITE_URL, WHALE_TRACKS,
} from './whaleSprite.js'

/** 形象动画的公开状态：待机或管家思考中。 */
export interface ButlerFishProps {
  /** 形象宽度（像素），高度按 192:208 帧比例推导。 */
  readonly size?: number
  /** 管家正在生成回答时为 true：播工作姿态帧并顶出思考气泡。 */
  readonly running?: boolean
}

/** 思考气泡样式：三点跳动。 */
const PET_CSS = `
.dfy-pet { display: inline-block; position: relative; image-rendering: auto; }
.dfy-pet-frame { display: block; background-repeat: no-repeat; }
/* 尺寸由 CSS 变量传入；cqw 分层增强：不认识 cqw 的内核退回固定宽（整条 min() 会静默失效，不能直接内联）。 */
.dfy-pet, .dfy-pet-frame { width: var(--dfy-hero-size, 110px); }
@supports (width: 1cqw) {
  .dfy-pet, .dfy-pet-frame { width: min(var(--dfy-hero-size, 110px), 88cqw); }
}
.dfy-bubble { position: absolute; right: -8px; top: -6px; display: flex; gap: 3px; padding: 4px 6px; border-radius: 9px; background: var(--dsw-color-bg-2, #eee); border: 1px solid var(--dsw-color-border-2, transparent); box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18); transform-origin: 100% 100%; animation: dfy-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.dfy-bubble i { display: block; width: 4px; height: 4px; border-radius: 50%; background: var(--dsw-color-text-1, #333); animation: dfy-dot 1s ease-in-out infinite; }
.dfy-bubble i:nth-child(2) { animation-delay: 0.15s; }
.dfy-bubble i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dfy-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.35; } 30% { transform: translateY(-3px); opacity: 1; } }
@keyframes dfy-pop { from { transform: scale(0.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .dfy-bubble i, .dfy-bubble { animation: none; } }
`

/**
 * 渲染鲸鱼娘管家：精灵图背景 + 按轨道时长逐帧切 background-position。
 * @param props - 尺寸与运行状态。
 * @returns 形象元素。
 */
export function ButlerFish({ size = 110, running = false }: ButlerFishProps) {
  const track = running ? WHALE_TRACKS.running : WHALE_TRACKS.idle
  const [frame, setFrame] = useState(0)
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // 系统偏好运行中切换也要生效，不只读挂载时的初值。
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent): void => { setReduced(event.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])

  useEffect(() => {
    if (reduced) {
      setFrame(0)
      return
    }
    // 轨道切换或帧推进后，按当前帧时长排下一次切换；轨道变化时先回到第 0 帧。
    if (frame >= track.durations.length) {
      setFrame(0)
      return
    }
    const timer = window.setTimeout(
      () => { setFrame(current => (current + 1) % track.durations.length) },
      track.durations[frame],
    )
    return () => { window.clearTimeout(timer) }
  }, [reduced, frame, track])

  // 图集几何与常量绑定：铺满倍数、行列定位都从 COLS/行数推导，重生成图集改列数不会静默错位。
  const spriteRows = 2
  const heroRatio = `${WHALE_FRAME_WIDTH} / ${WHALE_FRAME_HEIGHT}`
  const sheetSize = `${WHALE_SPRITE_COLS * 100}% ${spriteRows * 100}%`
  const positionX = (frame / (WHALE_SPRITE_COLS - 1)) * 100
  const positionY = (track.row / (spriteRows - 1)) * 100
  const heroStyle = { '--dfy-hero-size': `${size}px`, aspectRatio: heroRatio } as CSSProperties
  return (
    <span className="dfy-pet" style={heroStyle}>
      <style dangerouslySetInnerHTML={{ __html: PET_CSS }} />
      <span
        className="dfy-pet-frame"
        aria-hidden="true"
        style={{
          aspectRatio: heroRatio,
          backgroundImage: `url("${WHALE_SPRITE_URL}")`,
          backgroundSize: sheetSize,
          backgroundPosition: `${positionX}% ${positionY}%`,
        }}
      />
      {running && (
        <span className="dfy-bubble" aria-hidden="true"><i /><i /><i /></span>
      )}
    </span>
  )
}

/**
 * 鲸鱼娘人物头像（30px 圆形取景）：复用精灵图 idle 第 0 帧，放大裁人物头肩。
 * 取景按帧几何推导：background-size 780% 280% 使帧 0 缩放为 39×42（约 1.3 倍容器），
 * position-x 2.2% 把窗口对准人物面部（x 位移须留在帧 0 内，上限约 4.4%）。
 * byClaude
 */
export function ButlerAvatar() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        backgroundImage: `url("${WHALE_SPRITE_URL}")`,
        backgroundSize: '900% 323%',
        backgroundPosition: '2% 10.5%',
      }}
    />
  )
}
// byClaude-end
