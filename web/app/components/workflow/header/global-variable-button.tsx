import { memo } from 'react'
import Button from '@/app/components/base/button'
import { GlobalVariable } from '@/app/components/base/icons/src/vender/line/others'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store/workflow'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'

const GlobalVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const showGlobalVariablePanel = useStore(s => s.showGlobalVariablePanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleClick = () => {
    const { setShowGlobalVariablePanel, setShowEnvPanel, setShowChatVariablePanel, setShowDebugAndPreviewPanel } = workflowStore.getState()
    setShowGlobalVariablePanel(true)
    setShowEnvPanel(false)
    setShowChatVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
  }

  return (
    <Button
      className={cn(
        'rounded-lg border border-transparent p-2',
        theme === 'dark' && showGlobalVariablePanel && 'border-black/5 bg-white/10 backdrop-blur-sm',
      )}
      disabled={disabled}
      onClick={handleClick}
      variant="ghost"
    >
      <GlobalVariable className="h-4 w-4 text-components-button-secondary-text" />
    </Button>
  )
}

export default memo(GlobalVariableButton)
