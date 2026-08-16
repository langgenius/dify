import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks/use-input-field-panel'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'

const EnvButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const setShowChatVariablePanel = useStore((s) => s.setShowChatVariablePanel)
  const showEnvPanel = useStore((s) => s.showEnvPanel)
  const setShowEnvPanel = useStore((s) => s.setShowEnvPanel)
  const setShowGlobalVariablePanel = useStore((s) => s.setShowGlobalVariablePanel)
  const setShowDebugAndPreviewPanel = useStore((s) => s.setShowDebugAndPreviewPanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleClick = () => {
    setShowEnvPanel(true)
    setShowChatVariablePanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
  }

  return (
    <IconButton
      aria-label={t(($) => $['env.envPanelTitle'], { ns: 'workflow' })}
      aria-expanded={showEnvPanel}
      size="lg"
      className={cn(
        'border border-transparent',
        theme === 'dark' && showEnvPanel && 'border-black/5 bg-white/10 backdrop-blur-xs',
      )}
      variant="ghost"
      disabled={disabled}
      onClick={handleClick}
    >
      <span
        aria-hidden
        className="i-custom-vender-line-others-env size-4 text-components-button-secondary-text"
      />
    </IconButton>
  )
}

export default memo(EnvButton)
