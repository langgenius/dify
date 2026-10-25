'use client'

import { useAtom } from 'jotai'
import { documentTaskDrawerOpenAtom } from './state/workflow'
import { DocumentPermissionRecoveryNotice, DocumentTaskNotices } from './status'
import { DocumentDetailTasksDrawer } from './tasks/drawer'

export function DocumentTasksSurface() {
  const [open, setOpen] = useAtom(documentTaskDrawerOpenAtom)

  return (
    <>
      <DocumentTaskNotices onViewTasks={() => setOpen(true)} />
      <DocumentPermissionRecoveryNotice />
      <DocumentDetailTasksDrawer open={open} onOpenChange={setOpen} />
    </>
  )
}
