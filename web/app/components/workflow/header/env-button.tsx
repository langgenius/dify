import { memo } from 'react'
import Button from '@/app/components/base/button'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'

const EnvButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const showEnvPanel = useStore(s => s.showEnvPanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()
  const handleClick = () => {
    const { setShowChatVariablePanel, setShowEnvPanel, setShowGlobalVariablePanel, setShowDebugAndPreviewPanel } = workflowStore.getState()
    setShowEnvPanel(true)
    setShowChatVariablePanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
  }

  return (
    <Button
      className={cn(
        'rounded-lg border border-transparent p-2',
        theme === 'dark' && showEnvPanel && 'border-black/5 bg-white/10 backdrop-blur-sm',
      )}
      variant="ghost"
      disabled={disabled}
      onClick={handleClick}
    >
      <Env className="h-4 w-4 text-components-button-secondary-text" />
    </Button>
  )
}

export default memo(EnvButton)
