/**
 * 「更多」菜单里的大肥鱼入口行。
 * byClaude
 */
import { FishLogo, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** 入口动作面。 */
export interface FatfishMoreInjected {
  /** 打开大肥鱼主面板。 */
  readonly openPanel: () => void
}

type FatfishMoreRowProps = PropsRuntime<'sidebar.panellist.actions'>
  & InjectFace<FatfishMoreInjected>
  & PropsLocale<'dafeiyu'>

/**
 * 渲染更多菜单行：点击后关闭菜单并打开大肥鱼面板。
 * @param props - 菜单 owner 回调、注入动作与文案。
 * @returns 一行菜单项。
 */
export function FatfishMoreRow({ onDismiss, openPanel, t }: FatfishMoreRowProps) {
  return (
    <MenuItemButton icon={<FishLogo size={16} />} onSelect={() => {
      onDismiss()
      openPanel()
    }}>
      {t('more.open')}
    </MenuItemButton>
  )
}
