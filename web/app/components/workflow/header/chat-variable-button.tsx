import { memo } from 'react'
import Button from '@/app/components/base/button'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'

const ChatVariableButton = ({ disabled }: { disabled: boolean }) => {
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)

  const handleClick = () => {
    setShowChatVariablePanel(true)
    setShowEnvPanel(false)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <Button className='p-2' disabled={disabled} onClick={handleClick}>
      <BubbleX className='w-4 h-4 text-components-button-secondary-text' />
    </Button>
  )
}

export default memo(ChatVariableButton)
