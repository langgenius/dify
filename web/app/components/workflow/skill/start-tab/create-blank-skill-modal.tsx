'use client'

import type { BatchUploadNodeInput } from '@/types/app-asset'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useBatchUpload } from '@/service/use-app-asset'
import { useExistingSkillNames } from '../hooks/file-tree/data/use-skill-asset-tree'
import { useSkillTreeUpdateEmitter } from '../hooks/file-tree/data/use-skill-tree-collaboration'
import { prepareSkillUploadFile } from '../utils/skill-upload-utils'

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

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()

  const batchUpload = useBatchUpload()
  const batchUploadRef = useRef(batchUpload)
  batchUploadRef.current = batchUpload

  const emitTreeUpdate = useSkillTreeUpdateEmitter()
  const emitTreeUpdateRef = useRef(emitTreeUpdate)
  emitTreeUpdateRef.current = emitTreeUpdate

  const { data: existingNames } = useExistingSkillNames()

  const inputRef = useRef<HTMLInputElement>(null)

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
    storeApi.getState().setUploadStatus('uploading')
    storeApi.getState().setUploadProgress({ uploaded: 0, total: 1, failed: 0 })

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

      const createdNodes = await batchUploadRef.current.mutateAsync({
        appId,
        tree,
        files,
        parentId: null,
        onProgress: (uploaded, total) => {
          storeApi.getState().setUploadProgress({ uploaded, total, failed: 0 })
        },
      })

      storeApi.getState().setUploadStatus('success')
      emitTreeUpdateRef.current()

      const skillMdId = createdNodes?.[0]?.children?.[0]?.id
      if (skillMdId)
        storeApi.getState().openTab(skillMdId, { pinned: true })

      Toast.notify({ type: 'success', message: t('skill.startTab.createSuccess', { ns: 'workflow', name: trimmedName }) })
      onClose()
    }
    catch {
      storeApi.getState().setUploadStatus('partial_error')
      Toast.notify({ type: 'error', message: t('skill.startTab.createError', { ns: 'workflow' }) })
    }
    finally {
      setIsCreating(false)
      setSkillName('')
    }
  }, [canCreate, appId, trimmedName, storeApi, onClose, t])

  return (
    <Modal
      isShow={isOpen}
      onClose={handleClose}
      title={t('skill.startTab.createModal.title', { ns: 'workflow' })}
      closable={!isCreating}
      clickOutsideNotClose={isCreating}
      initialFocus={inputRef}
    >
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
    </Modal>
  )
}

export default memo(CreateBlankSkillModal)
