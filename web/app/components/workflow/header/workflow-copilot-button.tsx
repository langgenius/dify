import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'

const WorkflowCopilotButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const showWorkflowCopilotPanel = useStore((s) => s.showWorkflowCopilotPanel)
  const setShowWorkflowCopilotPanel = useStore((s) => s.setShowWorkflowCopilotPanel)
  const label = t(($) => $['copilot.buttonTooltip'], { ns: 'workflow' })

  const handleClick = () => {
    setShowWorkflowCopilotPanel(!showWorkflowCopilotPanel)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={showWorkflowCopilotPanel}
            className={cn(
              'rounded-lg border border-transparent p-2',
              theme === 'dark' &&
                showWorkflowCopilotPanel &&
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

export default memo(WorkflowCopilotButton)
