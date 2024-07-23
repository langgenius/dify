import { memo } from 'react'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'
import cn from '@/utils/classnames'

const EnvButton = () => {
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)

  const handleClick = () => {
    setShowEnvPanel(true)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <div className={cn('relative flex items-center justify-center p-0.5 w-8 h-8 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs cursor-pointer hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover')} onClick={handleClick}>
      <Env className='w-4 h-4 text-components-button-secondary-text' />
    </div>
  )
}

export default memo(EnvButton)
