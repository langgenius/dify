import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { CreateExternalAPIReq } from '../declarations'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@/context/modal-context'
import { consoleQuery } from '@/service/client'
import {
  checkUsageExternalAPI,
  deleteExternalAPI,
  fetchExternalAPI,
  updateExternalAPI,
} from '@/service/datasets'

type ExternalKnowledgeAPICardProps = {
  api: ExternalKnowledgeApiResponse
  canManageExternalKnowledgeApi: boolean
  position: number
}

const ExternalKnowledgeAPICard: React.FC<ExternalKnowledgeAPICardProps> = ({
  api,
  canManageExternalKnowledgeApi,
  position,
}) => {
  const { setShowExternalKnowledgeAPIModal } = useModalContext()
  const [showConfirm, setShowConfirm] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [usageCount, setUsageCount] = useState(0)
  const queryClient = useQueryClient()
  const externalKnowledgeApiQueryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({
    input: {},
  }).queryKey
  const endpoint =
    api.settings && typeof api.settings.endpoint === 'string' ? api.settings.endpoint : ''

  const { t } = useTranslation()

  const handleEditClick = async () => {
    if (!canManageExternalKnowledgeApi) return

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
            await queryClient.invalidateQueries({ queryKey: externalKnowledgeApiQueryKey })
          } catch (error) {
            console.error('Error updating external knowledge API:', error)
          }
        },
      })
    } catch (error) {
      console.error('Error fetching external knowledge API data:', error)
    }
  }

  const handleDeleteClick = async () => {
    if (!canManageExternalKnowledgeApi) return

    try {
      const usage = await checkUsageExternalAPI({ apiTemplateId: api.id })
      if (usage.is_using) setUsageCount(usage.count)

      setShowConfirm(true)
    } catch (error) {
      console.error('Error checking external API usage:', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!canManageExternalKnowledgeApi) return

    try {
      const response = await deleteExternalAPI({ apiTemplateId: api.id })
      if (response && response.result === 'success') {
        setShowConfirm(false)
        await queryClient.invalidateQueries({ queryKey: externalKnowledgeApiQueryKey })
      } else {
        console.error('Failed to delete external API')
      }
    } catch (error) {
      console.error('Error deleting external knowledge API:', error)
    }
  }

  return (
    <>
      <div
        className={`shadows-shadow-xs flex items-start self-stretch rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-2 pl-3 ${isHovered ? 'border-state-destructive-border bg-state-destructive-hover' : ''}`}
      >
        <div className="flex grow flex-col items-start justify-center gap-1.5 py-1">
          <div className="flex items-center gap-1 self-stretch text-text-secondary">
            <span
              aria-hidden
              className="i-custom-vender-solid-development-api-connection-mod size-4"
            />
            <div className="system-sm-medium">{api.name}</div>
          </div>
          <div className="self-stretch system-xs-regular text-text-tertiary">{endpoint}</div>
        </div>
        {canManageExternalKnowledgeApi && (
          <div className="flex items-start gap-1">
            <IconButton
              aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${api.name} ${endpoint} ${position}`}
              onClick={handleEditClick}
            >
              <span
                aria-hidden
                className="i-ri-edit-line size-4 text-text-tertiary hover:text-text-secondary"
              />
            </IconButton>
            <IconButton
              aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${api.name} ${endpoint} ${position}`}
              tone="destructive"
              onClick={handleDeleteClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <AlertDialog open={showConfirm} onOpenChange={(open) => !open && setShowConfirm(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {`${t(($) => $['deleteExternalAPIConfirmWarningContent.title.front'], { ns: 'dataset' })} ${api.name}${t(($) => $['deleteExternalAPIConfirmWarningContent.title.end'], { ns: 'dataset' })}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {usageCount > 0
                ? `${t(($) => $['deleteExternalAPIConfirmWarningContent.content.front'], { ns: 'dataset' })} ${usageCount} ${t(($) => $['deleteExternalAPIConfirmWarningContent.content.end'], { ns: 'dataset' })}`
                : t(($) => $['deleteExternalAPIConfirmWarningContent.noConnectionContent'], {
                    ns: 'dataset',
                  })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={handleConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default ExternalKnowledgeAPICard
