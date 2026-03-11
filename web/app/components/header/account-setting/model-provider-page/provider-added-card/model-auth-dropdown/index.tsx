import type { ModelProvider, PreferredProviderTypeEnum } from '../../declarations'
import type { CardVariant, CredentialPanelState } from '../use-credential-panel-state'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import DropdownContent from './dropdown-content'

type ModelAuthDropdownProps = {
  provider: ModelProvider
  state: CredentialPanelState
  isChangingPriority: boolean
  onChangePriority: (key: PreferredProviderTypeEnum) => void
}

function getButtonConfig(variant: CardVariant, hasCredentials: boolean, t: (key: string, opts?: Record<string, string>) => string) {
  if (variant === 'api-required-add') {
    return {
      text: t('modelProvider.auth.addApiKey', { ns: 'common' }),
      variant: 'primary' as const,
    }
  }

  if (variant === 'api-required-configure') {
    return {
      text: t('operation.config', { ns: 'common' }),
      variant: 'secondary-accent' as const,
    }
  }

  const text = hasCredentials
    ? t('operation.config', { ns: 'common' })
    : t('modelProvider.auth.addApiKey', { ns: 'common' })

  return { text, variant: 'secondary' as const }
}

function ModelAuthDropdown({
  provider,
  state,
  isChangingPriority,
  onChangePriority,
}: ModelAuthDropdownProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleClose = useCallback(() => setOpen(false), [])

  const buttonConfig = getButtonConfig(state.variant, state.hasCredentials, t)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button
            className="flex grow"
            size="small"
            variant={buttonConfig.variant}
            title={buttonConfig.text}
          >
            <span className="i-ri-equalizer-2-line mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="w-0 grow truncate text-left">
              {buttonConfig.text}
            </span>
          </Button>
        )}
      />
      <PopoverContent placement="bottom-end">
        <DropdownContent
          provider={provider}
          state={state}
          isChangingPriority={isChangingPriority}
          onChangePriority={onChangePriority}
          onClose={handleClose}
        />
      </PopoverContent>
    </Popover>
  )
}

export default memo(ModelAuthDropdown)
