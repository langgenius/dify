import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'

const ChatVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const showChatVariablePanel = useStore((s) => s.showChatVariablePanel)
  const setShowChatVariablePanel = useStore((s) => s.setShowChatVariablePanel)
  const setShowEnvPanel = useStore((s) => s.setShowEnvPanel)
  const setShowGlobalVariablePanel = useStore((s) => s.setShowGlobalVariablePanel)
  const setShowDebugAndPreviewPanel = useStore((s) => s.setShowDebugAndPreviewPanel)

  const handleClick = () => {
    setShowChatVariablePanel(true)
    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <IconButton
      aria-label={t(($) => $['chatVariable.panelTitle'], { ns: 'workflow' })}
      aria-expanded={showChatVariablePanel}
      size="lg"
      className={cn(
        'border border-transparent',
        theme === 'dark' && showChatVariablePanel && 'border-black/5 bg-white/10 backdrop-blur-xs',
      )}
      disabled={disabled}
      onClick={handleClick}
      variant="ghost"
    >
      <span
        aria-hidden
        className="i-custom-vender-line-others-bubble-x size-4 text-components-button-secondary-text"
      />
    </IconButton>
  )
}

export default memo(ChatVariableButton)
