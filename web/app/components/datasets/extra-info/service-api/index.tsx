import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiKeyModal } from '@/app/components/api-key/api-key-modal'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { ServiceApiCard } from './card'

type ServiceApiProps = {
  apiBaseUrl: string
}

export function ServiceApi({ apiBaseUrl }: ServiceApiProps) {
  const { t } = useTranslation()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageApiKey = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')

  return (
    <div className="flex items-center">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
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
          <ServiceApiCard
            apiBaseUrl={apiBaseUrl}
            canManageApiKey={canManageApiKey}
            onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
          />
        </PopoverContent>
      </Popover>
      <ApiKeyModal
        open={apiKeyModalOpen}
        onOpenChange={setApiKeyModalOpen}
        canManage={canManageApiKey}
        scope={{ type: 'dataset' }}
      />
    </div>
  )
}
