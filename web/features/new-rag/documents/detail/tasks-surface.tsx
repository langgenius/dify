'use client'

import { useState } from 'react'
import { DocumentPermissionRecoveryNotice, DocumentTaskNotices } from './status'
import { DocumentDetailTasksDrawer } from './tasks/drawer'

export function DocumentTasksSurface() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <DocumentTaskNotices onViewTasks={() => setOpen(true)} />
      <DocumentPermissionRecoveryNotice />
      <DocumentDetailTasksDrawer open={open} onOpenChange={setOpen} />
    </>
  )
}
