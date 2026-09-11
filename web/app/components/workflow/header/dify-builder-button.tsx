import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const DifyBuilderButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const showDifyBuilderPanel = useStore((s) => s.showDifyBuilderPanel)
  const setShowDifyBuilderPanel = useStore((s) => s.setShowDifyBuilderPanel)
  const label = t(($) => $['difyBuilder.buttonTooltip'], { ns: 'workflow' })

  // React Flow's nokey class preserves native Space activation on the button.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-expanded={showDifyBuilderPanel}
            aria-label={showDifyBuilderPanel ? label : undefined}
            className="nokey dify-blue-glass-surface relative h-8 shrink-0 rounded-lg p-2 text-text-accent! aria-expanded:w-8 data-disabled:text-components-button-ghost-text-disabled!"
            variant="ghost"
            disabled={disabled}
            onClick={() => setShowDifyBuilderPanel(!showDifyBuilderPanel)}
          >
            <span
              aria-hidden
              className="i-custom-public-app-builder-builder-mark size-4 shrink-0"
            />
            {!showDifyBuilderPanel && <span className="system-xs-semibold-uppercase">{label}</span>}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(DifyBuilderButton)
