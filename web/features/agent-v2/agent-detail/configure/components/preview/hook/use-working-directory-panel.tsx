'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { AgentWorkingDirectoryPanel } from '../working-directory-panel'

export function useAgentWorkingDirectoryPanel(): {
  closeWorkingDirectory: () => void
  openWorkingDirectory: () => void
  panel: ReactNode
} {
  const [open, setOpen] = useState(false)

  return {
    closeWorkingDirectory: () => setOpen(false),
    openWorkingDirectory: () => setOpen(true),
    panel: (
      <AgentWorkingDirectoryPanel
        open={open}
        onOpenChange={setOpen}
      />
    ),
  }
}
