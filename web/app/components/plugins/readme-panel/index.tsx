'use client'

import { ReadmeDialog } from './dialog'
import { ReadmeDrawer } from './drawer'
import { useReadmePanelStore } from './store'

export default function ReadmePanel() {
  const isOpen = useReadmePanelStore((s) => s.isOpen)
  const currentPanel = useReadmePanelStore((s) => s.currentPanel)
  const closeReadmePanel = useReadmePanelStore((s) => s.closeReadmePanel)
  const completeReadmePanelClose = useReadmePanelStore((s) => s.completeReadmePanelClose)

  if (!currentPanel) return null

  const onOpenChange = (open: boolean) => {
    if (!open) closeReadmePanel()
  }
  const onOpenChangeComplete = (open: boolean) => {
    if (!open) completeReadmePanelClose(currentPanel)
  }

  if (currentPanel.presentation === 'dialog') {
    return (
      <ReadmeDialog
        detail={currentPanel.detail}
        open={isOpen}
        onOpenChange={onOpenChange}
        onOpenChangeComplete={onOpenChangeComplete}
      />
    )
  }

  return (
    <ReadmeDrawer
      detail={currentPanel.detail}
      open={isOpen}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    />
  )
}
