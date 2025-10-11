import { memo, useEffect, useMemo, useRef } from 'react'
import { MiniMap } from 'reactflow'
import UndoRedo from '../header/undo-redo'
import ZoomInOut from './zoom-in-out'
import VariableTrigger from '../variable-inspect/trigger'
import VariableInspectPanel from '../variable-inspect'
import { useStore } from '../store'

export type OperatorProps = {
  handleUndo: () => void
  handleRedo: () => void
}

const Operator = ({ handleUndo, handleRedo }: OperatorProps) => {
  const bottomPanelRef = useRef<HTMLDivElement>(null)
  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const rightPanelWidth = useStore(s => s.rightPanelWidth)
  const setBottomPanelWidth = useStore(s => s.setBottomPanelWidth)
  const setBottomPanelHeight = useStore(s => s.setBottomPanelHeight)

  const bottomPanelWidth = useMemo(() => {
    if (!workflowCanvasWidth || !rightPanelWidth)
      return 'auto'
    return Math.max((workflowCanvasWidth - rightPanelWidth), 400)
  }, [workflowCanvasWidth, rightPanelWidth])

  // update bottom panel height
  useEffect(() => {
    if (bottomPanelRef.current) {
      const resizeContainerObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize, blockSize } = entry.borderBoxSize[0]
          setBottomPanelWidth(inlineSize)
          setBottomPanelHeight(blockSize)
        }
      })
      resizeContainerObserver.observe(bottomPanelRef.current)
      return () => {
        resizeContainerObserver.disconnect()
      }
    }
  }, [setBottomPanelHeight, setBottomPanelWidth])

  return (
    <div
      ref={bottomPanelRef}
      className='absolute bottom-0 left-0 right-0 z-10 px-1'
      style={
        {
          width: bottomPanelWidth,
        }
      }
    >
      <div className='flex justify-between px-1 pb-2'>
        <div className='flex items-center gap-2'>
          <UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />
        </div>
        <VariableTrigger />
        <div className='relative'>
          <MiniMap
            pannable
            zoomable
            style={{
              width: 102,
              height: 72,
            }}
            maskColor='var(--color-workflow-minimap-bg)'
            className='!absolute !bottom-10 z-[9] !m-0 !h-[73px] !w-[103px] !rounded-lg !border-[0.5px]
            !border-divider-subtle !bg-background-default-subtle !shadow-md !shadow-shadow-shadow-5'
          />
          <ZoomInOut />
        </div>
      </div>
      <VariableInspectPanel />
    </div>
  )
}

export default memo(Operator)
