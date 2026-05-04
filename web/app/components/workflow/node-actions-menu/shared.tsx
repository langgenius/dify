import type { RegisterableHotkey } from '@tanstack/react-hotkeys'
import type { ReactNode } from 'react'
import type { WorkflowShortcutId } from '@/app/components/workflow/shortcuts/definitions'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

export const NODE_ACTIONS_MENU_WIDTH_CLASS_NAME = 'w-[240px] rounded-lg'
export const NODE_ACTIONS_MENU_ITEM_WITH_SHORTCUT_CLASS_NAME = 'w-auto justify-between gap-4'

export function NodeActionsMenuItemContent({
  children,
  hotkey,
  shortcut,
}: {
  children: ReactNode
  hotkey?: RegisterableHotkey | (string & {})
  shortcut?: WorkflowShortcutId
}) {
  return (
    <>
      <span className="min-w-0 truncate">{children}</span>
      {(shortcut || hotkey) && <ShortcutKbd shortcut={shortcut} hotkey={hotkey} />}
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
      <div className="mb-1 flex h-[22px] items-center font-medium">
        {title.toLocaleUpperCase()}
      </div>
      <div className="mb-1 leading-[18px] text-text-secondary">{description}</div>
      <div className="leading-[18px]">{author}</div>
    </div>
  )
}
