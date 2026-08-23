import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'

const DifyBuilderButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const showDifyBuilderPanel = useStore((s) => s.showDifyBuilderPanel)
  const setShowDifyBuilderPanel = useStore((s) => s.setShowDifyBuilderPanel)
  const label = t(($) => $['difyBuilder.buttonTooltip'], { ns: 'workflow' })

  const handleClick = () => {
    setShowDifyBuilderPanel(!showDifyBuilderPanel)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={showDifyBuilderPanel}
            className={cn(
              'rounded-lg border border-transparent p-2',
              theme === 'dark' &&
                showDifyBuilderPanel &&
                'border-black/5 bg-white/10 backdrop-blur-xs',
            )}
            variant="ghost"
            disabled={disabled}
            onClick={handleClick}
          >
            <span
              aria-hidden
              className="i-ri-magic-line size-4 text-components-button-secondary-text"
            />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default memo(DifyBuilderButton)
