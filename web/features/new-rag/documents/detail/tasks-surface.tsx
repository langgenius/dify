'use client'

import { useState } from 'react'
import { DocumentDetailTasksDrawer } from '../tasks/drawer'
import { DocumentPermissionRecoveryNotice, DocumentTaskNotices } from './status'

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
