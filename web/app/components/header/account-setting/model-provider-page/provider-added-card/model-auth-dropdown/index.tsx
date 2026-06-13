import type { ModelProvider, PreferredProviderTypeEnum } from '../../declarations'
import type { CredentialPanelState } from '../use-credential-panel-state'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getButtonConfig } from './button-config'
import DropdownContent from './dropdown-content'

type ModelAuthDropdownProps = {
  provider: ModelProvider
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

  const handleClose = useCallback(() => setOpen(false), [])

  const buttonConfig = getButtonConfig(state.variant, state.hasCredentials, t)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button
            className="flex w-full min-w-0 justify-center px-2"
            size="small"
            variant={buttonConfig.variant}
            title={buttonConfig.text}
          >
            <span className="mr-1 i-ri-equalizer-2-line size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
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
