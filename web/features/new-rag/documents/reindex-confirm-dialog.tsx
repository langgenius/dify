'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
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
  confirmLabel,
  onConfirm,
  onOpenChange,
  open,
  scope,
}: {
  /** The confirm button's wording when more than one document is reindexed. */
  confirmLabel?: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  /** What is reindexed, when the page behind the dialog does not already say (a selection). */
  scope?: string
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
        {scope && (
          <DialogBody>
            <p className="system-sm-medium text-text-secondary">{scope}</p>
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose render={<Button />}>{tCommon(($) => $['operation.cancel'])}</DialogClose>
          <Button
            variant="primary"
            onClick={() => {
              // The popup stays on screen while it animates out: a second click then must not
              // start a second reindex.
              if (!open) return
              onOpenChange(false)
              onConfirm()
            }}
          >
            {confirmLabel ?? t(($) => $.reindexDocument)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
