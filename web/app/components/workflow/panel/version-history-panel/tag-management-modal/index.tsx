'use client'
import type { WorkflowTag } from '../../../types'
import type { VersionHistory } from '@/types/workflow'
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { useCreateWorkflowTag, useDeleteWorkflowTag } from '@/service/use-workflow-tag'

type TagManagementModalProps = {
  isOpen: boolean
  onClose: () => void
  versionHistory: VersionHistory
  tags: WorkflowTag[]
  onTagChange: () => void
}

const TagManagementModal: React.FC<TagManagementModalProps> = ({
  isOpen,
  onClose,
  versionHistory,
  tags,
  onTagChange,
}) => {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [isAddingNew, setIsAddingNew] = useState(false)
  const appDetail = useAppStore(s => s.appDetail)

  const { mutateAsync: createTag } = useCreateWorkflowTag(appDetail?.id || '')
  const { mutateAsync: deleteTag } = useDeleteWorkflowTag(appDetail?.id || '')

  const resetForm = useCallback(() => {
    setNewTagName('')
  }, [])

  const handleCreateTag = useCallback(async () => {
    if (!newTagName || !newTagName.trim()) {
      Toast.notify({
        type: 'error',
        message: t('tag.nameRequired', { ns: 'workflow' }),
      })
      return
    }

    setIsCreating(true)
    try {
      const result = await createTag({
        workflow_id: versionHistory.id,
        name: newTagName.trim(),
      })

      let message
      if (result.is_transferred) {
        if (result.old_workflow_id === versionHistory.id)
          message = t('tag.tagExists', { ns: 'workflow' })
        else
          message = t('tag.transferSuccess', { ns: 'workflow' })
      }
      else {
        message = t('tag.createSuccess', { ns: 'workflow' })
      }

      Toast.notify({
        type: 'success',
        message,
      })
      resetForm()
      setIsAddingNew(false)
      onTagChange()
    }
    catch (error: any) {
      Toast.notify({
        type: 'error',
        message: error.message || t('tag.createFailure', { ns: 'workflow' }),
      })
    }
    finally {
      setIsCreating(false)
    }
  }, [newTagName, versionHistory.id, createTag, resetForm, onTagChange, t])

  const handleDeleteTag = useCallback(async (tag: WorkflowTag) => {
    try {
      await deleteTag(tag.id)
      Toast.notify({
        type: 'success',
        message: t('tag.deleteSuccess', { ns: 'workflow' }),
      })
      onTagChange()
    }
    catch (error: any) {
      Toast.notify({
        type: 'error',
        message: error.message || t('tag.deleteFailure', { ns: 'workflow' }),
      })
    }
  }, [deleteTag, onTagChange, t])

  useEffect(() => {
    if (!isOpen)
      resetForm()
  }, [isOpen, resetForm])

  return (
    <Modal
      isShow={isOpen}
      onClose={onClose}
      title={`${t('tag.managementTitle', { ns: 'workflow' })} - ${versionHistory.marked_name || t('tag.untitled', { ns: 'workflow' })}`}
      className="max-h-[80vh] w-[600px] overflow-visible"
    >
      <div className="space-y-2 overflow-visible">

        <div>
          {tags && tags.length > 0
            ? (
                <div className="space-y-2">
                  {tags.map((tag: WorkflowTag) => (
                    <div key={tag.id} className="group flex items-center justify-between rounded-lg bg-gray-100 p-3 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">
                      <div className="flex flex-1 items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {tag.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>{tag.created_by.name}</span>
                          <span>·</span>
                          <span>{new Date(tag.created_at * 1000).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <button
                          type="button"
                          onClick={() => handleDeleteTag(tag)}
                          className="rounded-md p-1.5 text-gray-400 opacity-0 transition-all duration-200 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/20"
                          title={t('tag.deleteTag', { ns: 'workflow' })}
                        >
                          <RiDeleteBinLine className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            : (
                <div className="space-y-2">
                  <div className="py-8 text-center text-sm text-gray-400">
                    {t('tag.noTags', { ns: 'workflow' })}
                  </div>
                </div>
              )}
        </div>
        {isAddingNew
          ? (
              <div className="relative z-10 flex items-center space-x-3 rounded-md border-2 border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800">
                <div className="flex-1">
                  <Input
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    placeholder={t('tag.inputTag', { ns: 'workflow' })}
                    maxLength={255}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    disabled={!newTagName.trim() || isCreating}
                    className="rounded-md p-2 text-green-600 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-green-900/20"
                    title={t('tag.confirmAdd', { ns: 'workflow' })}
                  >
                    {isCreating
                      ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                        )
                      : (
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNew(false)
                      resetForm()
                    }}
                    className="rounded-md p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    title={t('tag.cancel', { ns: 'workflow' })}
                  >
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          : (
              <div className="pt-2">
                <div
                  className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-3 transition-colors hover:border-gray-400 hover:bg-gray-50 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-800"
                  onClick={() => setIsAddingNew(true)}
                >
                  <RiAddLine className="mr-2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t('tag.add', { ns: 'workflow' })}
                  </span>
                </div>
              </div>
            )}
      </div>
    </Modal>
  )
}

export default TagManagementModal
