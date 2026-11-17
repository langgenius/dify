import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { checkUsageExternalAPI, deleteExternalAPI } from '@/service/datasets'

type ExternalKnowledgeAPICardProps = {
  api: ExternalKnowledgeApiResponse
  canManageExternalKnowledgeApi: boolean
  onEdit: () => void
  position: number
}

const ExternalKnowledgeAPICard: React.FC<ExternalKnowledgeAPICardProps> = ({
  api,
  canManageExternalKnowledgeApi,
  onEdit,
  position,
}) => {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [usageCount, setUsageCount] = useState(0)
  const queryClient = useQueryClient()
  const externalKnowledgeApiQueryKey = consoleQuery.datasets.externalKnowledgeApi.get.queryOptions({
    input: {},
  }).queryKey
  const endpoint =
    api.settings && typeof api.settings.endpoint === 'string' ? api.settings.endpoint : ''

  const { t } = useTranslation(['common', 'dataset'])

  const handleDeleteClick = async () => {
    if (!canManageExternalKnowledgeApi) return

    try {
      const usage = await checkUsageExternalAPI({ apiTemplateId: api.id })
      setUsageCount(usage.is_using ? usage.count : 0)

      setShowConfirm(true)
    } catch (error) {
      console.error('Error checking external API usage:', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!canManageExternalKnowledgeApi || isDeleting) return

    setIsDeleting(true)
    try {
      await deleteExternalAPI({ apiTemplateId: api.id })
      setShowConfirm(false)
      await queryClient.invalidateQueries({ queryKey: externalKnowledgeApiQueryKey })
    } catch (error) {
      console.error('Error deleting external knowledge API:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="flex items-start self-stretch rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-2 ps-3 has-[.delete-api:hover]:border-state-destructive-border has-[.delete-api:hover]:bg-state-destructive-hover">
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
              onClick={onEdit}
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
              className="delete-api"
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <AlertDialog
        open={showConfirm}
        onOpenChange={(open, details) => {
          if (!open && isDeleting) details.cancel()
          else setShowConfirm(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`${t(($) => $['deleteExternalAPIConfirmWarningContent.title.front'], { ns: 'dataset' })} ${api.name}${t(($) => $['deleteExternalAPIConfirmWarningContent.title.end'], { ns: 'dataset' })}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {usageCount > 0
                ? `${t(($) => $['deleteExternalAPIConfirmWarningContent.content.front'], { ns: 'dataset' })} ${usageCount} ${t(($) => $['deleteExternalAPIConfirmWarningContent.content.end'], { ns: 'dataset' })}`
                : t(($) => $['deleteExternalAPIConfirmWarningContent.noConnectionContent'], {
                    ns: 'dataset',
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={handleConfirmDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default ExternalKnowledgeAPICard
