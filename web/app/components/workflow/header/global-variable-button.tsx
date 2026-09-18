import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks/use-input-field-panel'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'

const GlobalVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const showGlobalVariablePanel = useStore((s) => s.showGlobalVariablePanel)
  const setShowGlobalVariablePanel = useStore((s) => s.setShowGlobalVariablePanel)
  const setShowEnvPanel = useStore((s) => s.setShowEnvPanel)
  const setShowChatVariablePanel = useStore((s) => s.setShowChatVariablePanel)
  const setShowDebugAndPreviewPanel = useStore((s) => s.setShowDebugAndPreviewPanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleClick = () => {
    setShowGlobalVariablePanel(true)
    setShowEnvPanel(false)
    setShowChatVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton
            aria-label={t(($) => $['globalVar.title'], { ns: 'workflow' })}
            aria-expanded={showGlobalVariablePanel}
            size="lg"
            className={cn(
              'border border-transparent',
              theme === 'dark' &&
                showGlobalVariablePanel &&
                'border-black/5 bg-white/10 backdrop-blur-xs',
            )}
            disabled={disabled}
            onClick={handleClick}
            variant="ghost"
          >
            <span
              aria-hidden
              className="i-custom-vender-line-others-global-variable size-4 text-components-button-secondary-text"
            />
          </IconButton>
        }
      />
      <TooltipContent>{t(($) => $['globalVar.title'], { ns: 'workflow' })}</TooltipContent>
    </Tooltip>
  )
}

export default memo(GlobalVariableButton)
