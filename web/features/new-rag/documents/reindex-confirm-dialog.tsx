'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

/**
 * Asks before reindexing: chunks are rebuilt from the source file, which overwrites any edit
 * made to a chunk inside the knowledge base (such as adopting another document's statement).
 */
export function ReindexConfirmDialog({
  onConfirm,
  onOpenChange,
  open,
}: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation(['knowledgeDocuments'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(($) => $.reindexConfirmTitle)}</DialogTitle>
          <DialogDescription>{t(($) => $.reindexConfirmDescription)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>{tCommon(($) => $['operation.cancel'])}</DialogClose>
          <Button
            variant="primary"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {t(($) => $.reindexDocument)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
