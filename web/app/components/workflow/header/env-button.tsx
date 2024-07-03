import { memo } from 'react'
import cn from 'classnames'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import { useStore } from '@/app/components/workflow/store'

const EnvButton = () => {
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)

  const handleClick = () => {
    setShowEnvPanel(true)
    setShowDebugAndPreviewPanel(false)
  }

  return (
    <div className={cn('relative flex items-center justify-center mr-2 p-0.5 w-8 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs cursor-pointer')} onClick={handleClick}>
      <Env className='w-4 h-4 text-gray-500' />
    </div>
  )
}

export default memo(EnvButton)
