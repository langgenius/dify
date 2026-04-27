'use client'

import type { AccessRule } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useCallback, useState } from 'react'
import AccessRulesEditor from '@/app/components/access-rules-editor'

export type AccessConfigModalProps = {
  open: boolean
  title: string
  description: string
  initialRules: AccessRule[]
  /**
   * Optional override label for the primary action. Defaults to "Save".
   */
  saveLabel?: string
  /**
   * Optional override label for the cancel action. Defaults to "Cancel".
   */
  cancelLabel?: string
  onClose: () => void
  onSave?: (rules: AccessRule[]) => void
}

type AccessConfigModalBodyProps = Omit<AccessConfigModalProps, 'open'>

const AccessConfigModalBody = ({
  title,
  description,
  initialRules,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  onClose,
  onSave,
}: AccessConfigModalBodyProps) => {
  const [rules, setRules] = useState<AccessRule[]>(initialRules)

  const handleSave = useCallback(() => {
    onSave?.(rules)
    onClose()
  }, [onClose, onSave, rules])

  return (
    <DialogContent
      className="flex max-h-[85vh] w-[520px] flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-6 overscroll-contain' }}
      >
        <AccessRulesEditor rules={rules} onRulesChange={setRules} />
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {saveLabel}
        </Button>
      </div>
    </DialogContent>
  )
}

const AccessConfigModal = ({
  open,
  title,
  description,
  initialRules,
  saveLabel,
  cancelLabel,
  onClose,
  onSave,
}: AccessConfigModalProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      {open && (
        <AccessConfigModalBody
          title={title}
          description={description}
          initialRules={initialRules}
          saveLabel={saveLabel}
          cancelLabel={cancelLabel}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  )
}

export default AccessConfigModal
