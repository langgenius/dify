import { memo } from 'react'
import Button from '@/app/components/base/button'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'

const ChatVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const workflowStore = useWorkflowStore()
  const showChatVariablePanel = useStore(s => s.showChatVariablePanel)
  const handleClick = () => {
    const { setShowChatVariablePanel, setShowEnvPanel, setShowGlobalVariablePanel, setShowDebugAndPreviewPanel } = workflowStore.getState()
    setShowChatVariablePanel(true)
    setShowEnvPanel(false)
    setShowGlobalVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <Button
      className={cn(
        'rounded-lg border border-transparent p-2',
        theme === 'dark' && showChatVariablePanel && 'border-black/5 bg-white/10 backdrop-blur-sm',
      )}
      disabled={disabled}
      onClick={handleClick}
      variant="ghost"
    >
      <BubbleX className="h-4 w-4 text-components-button-secondary-text" />
    </Button>
  )
}

export default memo(ChatVariableButton)
