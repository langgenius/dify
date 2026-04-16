import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { Button } from '@/app/components/base/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import { useStore } from '@/app/components/workflow/store'

const EnvButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowGlobalVariablePanel = useStore(s => s.setShowGlobalVariablePanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()
  const label = t('env.envPanelTitle', { ns: 'workflow' })

  const handleClick = () => {
    setShowEnvPanel(true)
    setShowChatVariablePanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
  }

  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={(
          <Button
            aria-label={label}
            className={cn(
              'group h-7 w-7 rounded-md p-0 hover:bg-state-accent-hover',
              showEnvPanel && 'bg-state-accent-hover',
            )}
            variant="ghost"
            disabled={disabled}
            onClick={handleClick}
          >
            <Env
              className={cn(
                'h-4 w-4 group-hover:text-components-button-secondary-accent-text',
                showEnvPanel ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text',
              )}
            />
          </Button>
        )}
      />
      <TooltipContent className="bg-components-tooltip-bg">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(EnvButton)
