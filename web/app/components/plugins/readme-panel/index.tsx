'use client'

import { ReadmeDialog } from './dialog'
import { ReadmeDrawer } from './drawer'
import { useReadmePanelStore } from './store'

export default function ReadmePanel() {
  const currentPanel = useReadmePanelStore(s => s.currentPanel)
  const closeReadmePanel = useReadmePanelStore(s => s.closeReadmePanel)

  if (!currentPanel)
    return null

  const onOpenChange = (open: boolean) => {
    if (!open)
      closeReadmePanel()
  }

  if (currentPanel.presentation === 'dialog') {
    return (
      <ReadmeDialog
        detail={currentPanel.detail}
        open
        onOpenChange={onOpenChange}
        triggerId={currentPanel.triggerId}
      />
    )
  }

  return (
    <ReadmeDrawer
      detail={currentPanel.detail}
      open
      onOpenChange={onOpenChange}
      triggerId={currentPanel.triggerId}
    />
  )
}
