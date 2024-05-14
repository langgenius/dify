import { memo } from 'react'
import { MiniMap } from 'reactflow'
import ZoomInOut from './zoom-in-out'
import Control from './control'

const Operator = () => {
  return (
    <>
      <MiniMap
        style={{
          width: 102,
          height: 72,
        }}
        className='!absolute !left-4 !bottom-14 z-[9] !m-0 !w-[102px] !h-[72px] !border-[0.5px] !border-black/[0.08] !rounded-lg !shadow-lg'
      />
      <div className='flex items-center mt-1 gap-2 absolute left-4 bottom-4 z-[9]'>
        <ZoomInOut />
        <Control />
      </div>
    </>
  )
}

export default memo(Operator)
