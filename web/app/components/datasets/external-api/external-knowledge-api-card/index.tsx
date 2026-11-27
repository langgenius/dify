import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type ExternalKnowledgeAPICardProps = {
  api: ExternalKnowledgeApiResponse
  canManageExternalKnowledgeApi: boolean
  onEdit: () => void
  deletion: AlertDialogHandle<ExternalKnowledgeApiResponse>
  position: number
}

const ExternalKnowledgeAPICard = ({
  api,
  canManageExternalKnowledgeApi,
  onEdit,
  deletion,
  position,
}: ExternalKnowledgeAPICardProps) => {
  const endpoint =
    api.settings && typeof api.settings.endpoint === 'string' ? api.settings.endpoint : ''

  const { t } = useTranslation(['common', 'dataset'])

  return (
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
          <AlertDialogTrigger
            handle={deletion}
            payload={api}
            render={
              <IconButton
                aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${api.name} ${endpoint} ${position}`}
                tone="destructive"
                className="delete-api"
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
              </IconButton>
            }
          />
        </div>
      )}
    </div>
  )
}

export default ExternalKnowledgeAPICard
