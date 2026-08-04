import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiSparkling2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'

/**
 * Header toggle for the Workflow Copilot panel.
 *
 * Mirrors `header/env-button.tsx`: flips `showCopilotPanel` on and closes the
 * other right-side panels so only one is visible at a time.
 */
const CopilotTrigger = () => {
  const { t } = useTranslation()
  const showCopilotPanel = useStore(s => s.showCopilotPanel)
  const setShowCopilotPanel = useStore(s => s.setShowCopilotPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const setShowGlobalVariablePanel = useStore(s => s.setShowGlobalVariablePanel)

  const handleClick = () => {
    const next = !showCopilotPanel
    setShowCopilotPanel(next)
    if (next) {
      setShowDebugAndPreviewPanel(false)
      setShowEnvPanel(false)
      setShowChatVariablePanel(false)
      setShowGlobalVariablePanel(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            className={cn(
              'rounded-lg border border-transparent p-2',
              showCopilotPanel && 'border-components-button-secondary-border bg-state-accent-active',
            )}
            variant="ghost"
            onClick={handleClick}
          >
            <RiSparkling2Line className={cn('size-4 text-components-button-secondary-text', showCopilotPanel && 'text-text-accent')} />
          </Button>
        )}
      />
      <TooltipContent>
        {t('workflow.workflowGenerator.copilotTitle', { defaultValue: 'Workflow Copilot' })}
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(CopilotTrigger)
