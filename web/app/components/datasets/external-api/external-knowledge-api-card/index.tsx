import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import type { CreateExternalAPIReq } from '../declarations'
import type { ExternalAPIItem } from '@/models/datasets'
import { checkUsageExternalAPI, deleteExternalAPI, fetchExternalAPI, updateExternalAPI } from '@/service/datasets'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'
import { useModalContext } from '@/context/modal-context'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'

type ExternalKnowledgeAPICardProps = {
  api: ExternalAPIItem
}

const ExternalKnowledgeAPICard: React.FC<ExternalKnowledgeAPICardProps> = ({ api }) => {
  const { setShowExternalKnowledgeAPIModal } = useModalContext()
  const [showConfirm, setShowConfirm] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [usageCount, setUsageCount] = useState(0)
  const { mutateExternalKnowledgeApis } = useExternalKnowledgeApi()

  const { t } = useTranslation()

  const handleEditClick = async () => {
    try {
      const response = await fetchExternalAPI({ apiTemplateId: api.id })
      const formValue: CreateExternalAPIReq = {
        name: response.name,
        settings: {
          endpoint: response.settings.endpoint,
          api_key: response.settings.api_key,
        },
      }

      setShowExternalKnowledgeAPIModal({
        payload: formValue,
        onSaveCallback: () => {
          mutateExternalKnowledgeApis()
        },
        onCancelCallback: () => {
          mutateExternalKnowledgeApis()
        },
        isEditMode: true,
        datasetBindings: response.dataset_bindings,
        onEditCallback: async (updatedData: CreateExternalAPIReq) => {
          try {
            await updateExternalAPI({
              apiTemplateId: api.id,
              body: {
                ...response,
                name: updatedData.name,
                settings: {
                  ...response.settings,
                  endpoint: updatedData.settings.endpoint,
                  api_key: updatedData.settings.api_key,
                },
              },
            })
            mutateExternalKnowledgeApis()
          }
          catch (error) {
            console.error('Error updating external knowledge API:', error)
          }
        },
      })
    }
    catch (error) {
      console.error('Error fetching external knowledge API data:', error)
    }
  }

  const handleDeleteClick = async () => {
    try {
      const usage = await checkUsageExternalAPI({ apiTemplateId: api.id })
      if (usage.is_using)
        setUsageCount(usage.count)

      setShowConfirm(true)
    }
    catch (error) {
      console.error('Error checking external API usage:', error)
    }
  }

  const handleConfirmDelete = async () => {
    try {
      const response = await deleteExternalAPI({ apiTemplateId: api.id })
      if (response && response.result === 'success') {
        setShowConfirm(false)
        mutateExternalKnowledgeApis()
      }
      else {
        console.error('Failed to delete external API')
      }
    }
    catch (error) {
      console.error('Error deleting external knowledge API:', error)
    }
  }

  return (
    <>
      <div className={`shadows-shadow-xs flex items-start self-stretch rounded-lg border-[0.5px] border-components-panel-border-subtle
        bg-components-panel-on-panel-item-bg p-2
        pl-3 ${isHovered ? 'border-state-destructive-border bg-state-destructive-hover' : ''}`}
      >
        <div className='flex grow flex-col items-start justify-center gap-1.5 py-1'>
          <div className='flex items-center gap-1 self-stretch text-text-secondary'>
            <ApiConnectionMod className='h-4 w-4' />
            <div className='system-sm-medium'>{api.name}</div>
          </div>
          <div className='system-xs-regular self-stretch text-text-tertiary'>{api.settings.endpoint}</div>
        </div>
        <div className='flex items-start gap-1'>
          <ActionButton onClick={handleEditClick}>
            <RiEditLine className='h-4 w-4 text-text-tertiary hover:text-text-secondary' />
          </ActionButton>
          <ActionButton
            className='hover:bg-state-destructive-hover'
            onClick={handleDeleteClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <RiDeleteBinLine className='h-4 w-4 text-text-tertiary hover:text-text-destructive' />
          </ActionButton>
        </div>
      </div>
      {showConfirm && (
        <Confirm
          isShow={showConfirm}
          title={`${t('dataset.deleteExternalAPIConfirmWarningContent.title.front')} ${api.name}${t('dataset.deleteExternalAPIConfirmWarningContent.title.end')}`}
          content={
            usageCount > 0
              ? `${t('dataset.deleteExternalAPIConfirmWarningContent.content.front')} ${usageCount} ${t('dataset.deleteExternalAPIConfirmWarningContent.content.end')}`
              : t('dataset.deleteExternalAPIConfirmWarningContent.noConnectionContent')
          }
          type='warning'
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  )
}

export default ExternalKnowledgeAPICard
