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
  const [isProviderDetailError, setIsProviderDetailError] = useState(false)
  const isFullProvider = !('is_configured' in provider) || 'provider_credential_schema' in provider
  const { providerDetail, loadProviderDetail, isProviderDetailEnabled, isLoadingProviderDetail } =
    useLazyModelProviderDetail(provider.provider)
  const currentProvider = isFullProvider ? provider : providerDetail

  const handleClose = useCallback(() => {
    setOpen(false)
    setIsProviderDetailError(false)
  }, [])

  const buttonConfig = getButtonConfig(state.variant, state.hasCredentials, t)
  const loadDetail = useCallback(async () => {
    setIsProviderDetailError(false)
    const detail = await loadProviderDetail()
    if (!detail) setIsProviderDetailError(true)
  }, [loadProviderDetail])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
      return
    }

    setOpen(true)

    if (
      !isFullProvider &&
      !(currentProvider && isProviderDetailEnabled && !isLoadingProviderDetail)
    )
      void loadDetail()
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
            <span className="i-ri-equalizer-2-line size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{buttonConfig.text}</span>
          </Button>
        }
      />
      <PopoverContent placement="bottom-end">
        {currentProvider ? (
          <DropdownContent
            provider={currentProvider}
            state={state}
            isChangingPriority={isChangingPriority}
            onChangePriority={onChangePriority}
            onClose={handleClose}
          />
        ) : isProviderDetailError ? (
          <div className="flex w-80 flex-col items-start gap-3 p-4" role="alert">
            <span className="system-sm-medium text-text-primary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </span>
            <Button size="small" variant="secondary" onClick={() => void loadDetail()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        ) : (
          <div
            className="flex w-80 items-center justify-center gap-2 p-4"
            role="status"
            aria-busy="true"
          >
            <span
              aria-hidden
              className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
            />
            <span className="system-sm-regular text-text-secondary">
              {t(($) => $.loading, { ns: 'common' })}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(ModelAuthDropdown)
