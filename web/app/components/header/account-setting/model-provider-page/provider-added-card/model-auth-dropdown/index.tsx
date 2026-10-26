import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider, PreferredProviderTypeEnum } from '../../declarations'
import type { CredentialPanelState } from '../use-credential-panel-state'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { modelProviderDetailsQueryOptions } from '../../utils'
import { getButtonConfig } from './button-config'
import DropdownContent from './dropdown-content'

type ModelAuthDropdownProps = {
  provider: ModelProviderSummaryResponse | ModelProvider
  state: CredentialPanelState
  isChangingPriority: boolean
  onChangePriority: (key: PreferredProviderTypeEnum) => void
}

function ModelAuthDropdown({
  provider,
  state,
  isChangingPriority,
  onChangePriority,
}: ModelAuthDropdownProps) {
  const { t } = useTranslation(['common', 'modelProvider'])
  const [requestedOpen, setRequestedOpen] = useState(false)
  const isFullProvider = !('is_configured' in provider) || 'provider_credential_schema' in provider
  const detailQuery = useQuery({
    ...modelProviderDetailsQueryOptions(),
    enabled: requestedOpen && !isFullProvider,
    retry: false,
  })
  const currentProvider = isFullProvider
    ? provider
    : detailQuery.data?.data.find((item) => item.provider === provider.provider)
  const loading = requestedOpen && !isFullProvider && detailQuery.isLoading
  const open = requestedOpen && (isFullProvider || !detailQuery.isPending)
  const buttonConfig = getButtonConfig(state.variant, state.hasCredentials, t)

  return (
    <Popover open={open} onOpenChange={setRequestedOpen}>
      <PopoverTrigger
        render={
          <Button
            className="flex w-full min-w-0 justify-center px-2"
            size="small"
            variant={buttonConfig.variant}
            title={buttonConfig.text}
            loading={loading}
          >
            <span className="i-ri-equalizer-2-line size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{buttonConfig.text}</span>
          </Button>
        }
      />
      <PopoverContent align="end">
        <PopoverTitle className="sr-only">{buttonConfig.text}</PopoverTitle>
        {currentProvider ? (
          <DropdownContent
            provider={currentProvider}
            state={state}
            isChangingPriority={isChangingPriority}
            onChangePriority={onChangePriority}
            onClose={() => setRequestedOpen(false)}
          />
        ) : (
          <div className="flex w-80 flex-col items-start gap-3 p-4" role="alert">
            <span className="system-sm-medium text-text-primary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </span>
            <Button size="small" variant="secondary" onClick={() => void detailQuery.refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(ModelAuthDropdown)
