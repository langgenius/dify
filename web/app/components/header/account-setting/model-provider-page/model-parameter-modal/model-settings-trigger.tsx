import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'

type ModelSettingsTriggerProps = {
  disabled?: boolean
  surface?: 'default' | 'workflow'
}

function ModelSettingsTrigger({ disabled, surface = 'default' }: ModelSettingsTriggerProps) {
  const { t } = useTranslation()
  const label = t(($) => $['modelProvider.modelSettings'], { ns: 'common' })

  return (
    <Tooltip>
      <TooltipTrigger
        disabled={disabled}
        render={
          <PopoverTrigger
            disabled={disabled}
            render={
              <IconButton
                aria-label={label}
                className="relative shrink-0 rounded-l-none! rounded-r-lg! focus-visible:z-1 data-[surface=workflow]:bg-workflow-block-parma-bg data-[surface=workflow]:hover:bg-workflow-block-parma-bg"
                data-surface={surface}
                disabled={disabled}
                size="lg"
                variant="tertiary"
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              </IconButton>
            }
          />
        }
      />
      <TooltipContent placement="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export { ModelSettingsTrigger }
