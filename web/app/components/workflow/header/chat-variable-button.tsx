import { memo } from 'react'
import Button from '@/app/components/base/button'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import cn from '@/utils/classnames'

const ChatVariableButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)

  const handleClick = () => {
    setShowChatVariablePanel(true)
    setShowEnvPanel(false)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <Button
      className={cn(
        'p-2',
        theme === 'dark' && 'rounded-lg border border-black/5 bg-white/10 backdrop-blur-sm',
      )}
      disabled={disabled}
      onClick={handleClick}
    >
      <BubbleX className='h-4 w-4 text-components-button-secondary-text' />
    </Button>
  )
}

export default memo(ChatVariableButton)
