import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { Button } from '@/app/components/base/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useStore } from '@/app/components/workflow/store'

const ChatVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation()
  const showChatVariablePanel = useStore(s => s.showChatVariablePanel)
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowGlobalVariablePanel = useStore(s => s.setShowGlobalVariablePanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const label = t('chatVariable.panelTitle', { ns: 'workflow' })

  const handleClick = () => {
    setShowChatVariablePanel(true)
    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
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
              showChatVariablePanel && 'bg-state-accent-hover',
            )}
            disabled={disabled}
            onClick={handleClick}
            variant="ghost"
          >
            <BubbleX
              className={cn(
                'h-4 w-4 group-hover:text-components-button-secondary-accent-text',
                showChatVariablePanel ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text',
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

export default memo(ChatVariableButton)
