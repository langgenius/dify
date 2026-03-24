'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'

type NodeDeleteConfirmDialogProps = {
  nodeType: 'file' | 'folder'
  open: boolean
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

const NodeDeleteConfirmDialog = ({
  nodeType,
  open,
  isDeleting,
  onConfirm,
  onCancel,
}: NodeDeleteConfirmDialogProps) => {
  const { t } = useTranslation('workflow')
  const isFolder = nodeType === 'folder'

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onCancel()
      }}
    >
      <AlertDialogContent>
        <div className="flex flex-col gap-2 p-6 pb-4">
          <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
            {isFolder
              ? t('skillSidebar.menu.deleteConfirmTitle')
              : t('skillSidebar.menu.fileDeleteConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-text-secondary system-sm-regular">
            {isFolder
              ? t('skillSidebar.menu.deleteConfirmContent')
              : t('skillSidebar.menu.fileDeleteConfirmContent')}
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton>
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {t('operation.confirm', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default React.memo(NodeDeleteConfirmDialog)
