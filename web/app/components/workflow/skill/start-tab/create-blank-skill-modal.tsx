'use client'

import type { BatchUploadNodeInput } from '@/types/app-asset'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { useExistingSkillNames } from '../hooks/file-tree/data/use-skill-asset-tree'
import { prepareSkillUploadFile } from '../utils/skill-upload-utils'
import { useSkillBatchUpload } from './use-skill-batch-upload'

const SKILL_MD_TEMPLATE = (name: string) => `---
name: ${name}
description:
---

# ${name}
`

type CreateBlankSkillModalProps = {
  isOpen: boolean
  onClose: () => void
}

const CreateBlankSkillModal = ({ isOpen, onClose }: CreateBlankSkillModalProps) => {
  const { t } = useTranslation()
  const [skillName, setSkillName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const {
    appId,
    startUpload,
    failUpload,
    uploadTree,
    openCreatedSkillDocument,
  } = useSkillBatchUpload()

  const { data: existingNames } = useExistingSkillNames()

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen)
      queueMicrotask(() => inputRef.current?.focus())
  }, [isOpen])

  const trimmedName = skillName.trim()
  const isDuplicate = !!trimmedName && (existingNames?.has(trimmedName) ?? false)
  const canCreate = !!trimmedName && !isDuplicate && !isCreating

  const handleClose = useCallback(() => {
    if (isCreating)
      return
    setSkillName('')
    onClose()
  }, [isCreating, onClose])

  const handleCreate = useCallback(async () => {
    if (!canCreate || !appId)
      return

    setIsCreating(true)
    startUpload(1)

    try {
      const content = SKILL_MD_TEMPLATE(trimmedName)
      const rawFile = new File([content], 'SKILL.md', { type: 'text/markdown' })
      const preparedFile = await prepareSkillUploadFile(rawFile)

      const tree: BatchUploadNodeInput[] = [{
        name: trimmedName,
        node_type: 'folder',
        children: [{ name: 'SKILL.md', node_type: 'file', size: preparedFile.size }],
      }]

      const files = new Map<string, File>()
      files.set(`${trimmedName}/SKILL.md`, preparedFile)

      const createdNodes = await uploadTree({ tree, files })
      openCreatedSkillDocument(createdNodes)

      toast.success(t('skill.startTab.createSuccess', { ns: 'workflow', name: trimmedName }))
      onClose()
    }
    catch {
      failUpload()
      toast.error(t('skill.startTab.createError', { ns: 'workflow' }))
    }
    finally {
      setIsCreating(false)
      setSkillName('')
    }
  }, [appId, canCreate, failUpload, onClose, openCreatedSkillDocument, startUpload, t, trimmedName, uploadTree])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open)
          handleClose()
      }}
      disablePointerDismissal={isCreating}
    >
      <DialogContent>
        {!isCreating && <DialogCloseButton />}
        <DialogTitle className="text-text-primary title-2xl-semi-bold">
          {t('skill.startTab.createModal.title', { ns: 'workflow' })}
        </DialogTitle>
        <div className="mt-6 flex flex-col gap-1">
          <label className="text-text-secondary system-sm-semibold">
            {t('skill.startTab.createModal.nameLabel', { ns: 'workflow' })}
          </label>
          <Input
            ref={inputRef}
            value={skillName}
            onChange={e => setSkillName(e.target.value)}
            placeholder={t('skill.startTab.createModal.namePlaceholder', { ns: 'workflow' }) || ''}
            destructive={isDuplicate}
            disabled={isCreating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate)
                handleCreate()
            }}
          />
          {isDuplicate && (
            <p className="text-text-destructive system-xs-regular">
              {t('skill.startTab.createModal.nameDuplicate', { ns: 'workflow' })}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={handleClose}
            disabled={isCreating}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!canCreate}
            loading={isCreating}
          >
            {t('operation.create', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(CreateBlankSkillModal)
