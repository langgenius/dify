import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

const DifyBuilderButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const setShowDifyBuilderPanel = useStore((s) => s.setShowDifyBuilderPanel)
  const label = t(($) => $['difyBuilder.buttonTooltip'], { ns: 'workflow' })

  const handleClick = () => {
    setShowDifyBuilderPanel(true)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="dify-blue-glass-surface relative h-8 shrink-0 rounded-lg p-2 text-text-accent! data-disabled:text-components-button-ghost-text-disabled!"
            variant="ghost"
            disabled={disabled}
            onClick={handleClick}
          >
            <span
              aria-hidden
              className="i-ri-chat-ai-line size-4 shrink-0 drop-shadow-[0_0_4px_var(--color-components-main-nav-glass-text-glow)]"
            />
            <span className="system-xs-semibold-uppercase">{label}</span>
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(DifyBuilderButton)
