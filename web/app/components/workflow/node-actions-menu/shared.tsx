import type { ReactNode } from 'react'
import type { WorkflowCanvasShortcutId } from '@/app/components/workflow/shortcuts/definitions'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

export const NODE_ACTIONS_MENU_WIDTH_CLASS_NAME = 'w-[240px] rounded-lg'
export const NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME = 'w-auto justify-between gap-4'
export const NODE_ACTIONS_MENU_DELETE_ITEM_CLASS_NAME = `${NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME} text-text-secondary data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive`

export function NodeActionsMenuItemContent({
  children,
  shortcut,
}: {
  children: ReactNode
  shortcut?: WorkflowCanvasShortcutId
}) {
  return (
    <>
      <span className="min-w-0 truncate">{children}</span>
      {shortcut && <ShortcutKbd shortcut={shortcut} />}
    </>
  )
}

export function NodeActionsMenuAbout({
  author,
  description,
  title,
}: {
  author?: string
  description?: string
  title: string
}) {
  return (
    <div className="px-3 py-2 text-xs text-text-tertiary">
      <div className="mb-1 flex h-[22px] items-center font-medium">{title.toLocaleUpperCase()}</div>
      <div className="mb-1 leading-[18px] text-text-secondary">{description}</div>
      <div className="leading-[18px]">{author}</div>
    </div>
  )
}
