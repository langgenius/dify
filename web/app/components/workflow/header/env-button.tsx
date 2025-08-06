import { memo } from 'react'
import Button from '@/app/components/base/button'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import useTheme from '@/hooks/use-theme'
import cn from '@/utils/classnames'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'

const EnvButton = ({ disabled }: { disabled: boolean }) => {
  const { theme } = useTheme()
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const { closeAllInputFieldPanels } = useInputFieldPanel()

  const handleClick = () => {
    setShowEnvPanel(true)
    setShowChatVariablePanel(false)
    setShowDebugAndPreviewPanel(false)
    closeAllInputFieldPanels()
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
      <Env className='h-4 w-4 text-components-button-secondary-text' />
    </Button>
  )
}

export default memo(EnvButton)
