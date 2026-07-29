import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider, PreferredProviderTypeEnum } from '../../declarations'
import type { CredentialPanelState } from '../use-credential-panel-state'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLazyModelProviderDetail } from '../../hooks'
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isFullProvider = !('is_configured' in provider) || 'provider_credential_schema' in provider
  const { providerDetail, loadProviderDetail, isProviderDetailEnabled, isLoadingProviderDetail } =
    useLazyModelProviderDetail(provider.provider)
  const currentProvider = isFullProvider ? provider : providerDetail

  const handleClose = useCallback(() => setOpen(false), [])

  const buttonConfig = getButtonConfig(state.variant, state.hasCredentials, t)
  const handleOpenChange = async (nextOpen: boolean) => {
    if (!nextOpen) {
      setOpen(false)
      return
    }

    if (
      isFullProvider ||
      (currentProvider && isProviderDetailEnabled && !isLoadingProviderDetail)
    ) {
      setOpen(true)
      return
    }

    const detail = await loadProviderDetail()
    if (detail) setOpen(true)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            className="flex w-full min-w-0 justify-center px-2"
            size="small"
            variant={buttonConfig.variant}
            title={buttonConfig.text}
            loading={isLoadingProviderDetail}
          >
            <span className="mr-1 i-ri-equalizer-2-line size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{buttonConfig.text}</span>
          </Button>
        }
      />
      <PopoverContent placement="bottom-end">
        {currentProvider && (
          <DropdownContent
            provider={currentProvider}
            state={state}
            isChangingPriority={isChangingPriority}
            onChangePriority={onChangePriority}
            onClose={handleClose}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(ModelAuthDropdown)
