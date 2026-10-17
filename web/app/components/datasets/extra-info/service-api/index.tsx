import { cn } from '@langgenius/dify-ui/cn'
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
}

export function ServiceApi({ apiBaseUrl }: ServiceApiProps) {
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
            render={(props) => (
              <button
                {...props}
                type="button"
                className={cn(
                  'relative flex h-6 w-full cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-md border-none bg-transparent px-1.5 py-1 text-left text-text-tertiary hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
                  props.className,
                )}
              >
                <StatusDot className="shrink-0" status={apiBaseUrl ? 'success' : 'warning'} />
                <div className="px-0.5 system-xs-medium">
                  {t(($) => $['serviceApi.title'], { ns: 'dataset' })}
                </div>
              </button>
            )}
          />
          <PopoverContent
            placement="top-start"
            sideOffset={4}
            alignOffset={-4}
            className="border-none bg-transparent shadow-none"
          >
            <ServiceApiCard apiBaseUrl={apiBaseUrl} canManageApiKey={canManageApiKey} />
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
