import { Button } from '@langgenius/dify-ui/button'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DatasetApiKeyDialogContent } from '@/app/components/api-key/dataset-api-key-dialog-content'
import { useDatasetApiKeyMutations } from '@/app/components/api-key/use-dataset-api-key-mutations'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { ServiceApiCard } from './card'

type ServiceApiProps = {
  apiBaseUrl: string
  apiReferenceUrl?: string
}

export function ServiceApi({ apiBaseUrl, apiReferenceUrl }: ServiceApiProps) {
  const { t } = useTranslation(['dataset', 'appApi'])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageApiKey = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')
  const mutations = useDatasetApiKeyMutations()

  return (
    <div className="flex items-center">
      <Dialog
        onOpenChange={(open, details) => {
          if (!open && mutations.pending) details.cancel()
        }}
      >
        <Popover>
          <PopoverTrigger
            ref={triggerRef}
            render={
              <Button
                variant="ghost"
                size="small"
                className="text-text-tertiary data-popup-open:bg-components-button-ghost-bg-hover"
              />
            }
          >
            <StatusDot className="shrink-0" status={apiBaseUrl ? 'success' : 'warning'} />
            <span className="system-xs-medium">
              {t(($) => $['serviceApi.title'], { ns: 'dataset' })}
            </span>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={4}
            alignOffset={-4}
            className="border-none bg-transparent shadow-none"
          >
            <ServiceApiCard
              apiBaseUrl={apiBaseUrl}
              apiReferenceUrl={apiReferenceUrl}
              canManageApiKey={canManageApiKey}
            />
          </PopoverContent>
        </Popover>
        <DatasetApiKeyDialogContent
          canManage={canManageApiKey}
          mutations={mutations}
          finalFocus={triggerRef}
        />
      </Dialog>
    </div>
  )
}
