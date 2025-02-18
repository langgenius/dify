import { memo } from 'react'
import { MiniMap } from 'reactflow'
import UndoRedo from '../header/undo-redo'
import ZoomInOut from './zoom-in-out'
import Control from './control'

export type OperatorProps = {
  handleUndo: () => void
  handleRedo: () => void
}

const Operator = ({ handleUndo, handleRedo }: OperatorProps) => {
  return (
    <>
      <MiniMap
        pannable
        zoomable
        style={{
          width: 102,
          height: 72,
        }}
        maskColor='var(--color-workflow-minimap-bg)'
        className='!border-divider-subtle !shadow-shadow-shadow-5 !bg-background-default-subtle !absolute !bottom-14 !left-4 z-[9] !m-0 !h-[72px]
        !w-[102px] !rounded-lg !border-[0.5px] !shadow-md'
      />
      <div className='absolute bottom-4 left-4 z-[9] mt-1 flex items-center gap-2'>
        <ZoomInOut />
        <UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />
        <Control />
      </div>
    </>
  )
}

export default memo(Operator)
