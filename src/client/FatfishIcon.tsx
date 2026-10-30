/**
 * 大肥鱼侧边栏面板行的图标（鲸鱼标）。
 * byClaude
 */
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * 渲染面板行图标；侧边栏自己持有可访问的导航标签。
 * @param props - 侧边栏图标份额（请求的尺寸与选中态）。
 * @returns 装饰性鲸鱼图标。
 */
export function FatfishIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <FishLogo size={size ?? 22} />
}
