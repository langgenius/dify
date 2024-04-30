import { memo } from 'react'
import { MiniMap } from 'reactflow'
import ZoomInOut from './zoom-in-out'
import Control from './control'

const Operator = () => {
  return (
    <div className={`
      absolute left-4 bottom-4 z-[9]
    `}>
      <MiniMap
        style={{
          width: 128,
          height: 80,
        }}
        className='!static !m-0 !w-[128px] !h-[80px] !border-[0.5px] !border-black/[0.08] !rounded-lg !shadow-lg'
      />
      <div className='flex items-center mt-1 gap-2'>
        <ZoomInOut />
        <Control />
      </div>
    </div>
  )
}

export default memo(Operator)
