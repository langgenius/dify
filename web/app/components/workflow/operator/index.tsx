import type { Node } from 'reactflow'
import { memo, useCallback, useState } from 'react'
import { MiniMap } from 'reactflow'
import UndoRedo from '../header/undo-redo'
import { useWorkflowViewport } from '../hooks/use-workflow-viewport'
import { useStore } from '../store'
import { ControlMode } from '../types'
import VariableInspectPanel from '../variable-inspect'
import VariableTrigger from '../variable-inspect/trigger'
import ZoomInOut from './zoom-in-out'

type OperatorProps = {
  handleUndo: () => void
  handleRedo: () => void
}

const Operator = ({ handleUndo, handleRedo }: OperatorProps) => {
  const [showMiniMap, setShowMiniMap] = useState(true)
  const showUserCursors = useStore((s) => s.showUserCursors)
  const setShowUserCursors = useStore((s) => s.setShowUserCursors)
  const showUserComments = useStore((s) => s.showUserComments)
  const setShowUserComments = useStore((s) => s.setShowUserComments)
  const controlMode = useStore((s) => s.controlMode)
  const isCommentMode = controlMode === ControlMode.Comment
  const { handleViewportUserInteraction } = useWorkflowViewport()

  const handleToggleMiniMap = useCallback(() => {
    setShowMiniMap((prev) => !prev)
  }, [])

  const handleToggleUserCursors = useCallback(() => {
    setShowUserCursors(!showUserCursors)
  }, [showUserCursors, setShowUserCursors])

  const handleToggleUserComments = useCallback(() => {
    setShowUserComments(!showUserComments)
  }, [showUserComments, setShowUserComments])

  const getMiniMapNodeClassName = useCallback((node: Node) => {
    return node.data?.selected
      ? 'bg-workflow-minimap-block border-components-option-card-option-selected-border'
      : 'bg-workflow-minimap-block'
  }, [])

  return (
    <div className="px-1">
      <div className="flex justify-between px-1 pb-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <UndoRedo handleUndo={handleUndo} handleRedo={handleRedo} />
        </div>
        <VariableTrigger />
        <div className="pointer-events-auto relative">
          {showMiniMap && (
            <MiniMap
              pannable
              zoomable
              onPointerDownCapture={handleViewportUserInteraction}
              onWheelCapture={handleViewportUserInteraction}
              style={{
                width: 102,
                height: 72,
              }}
              maskColor="var(--color-workflow-minimap-bg)"
              nodeClassName={getMiniMapNodeClassName}
              nodeStrokeWidth={3}
              className="absolute! bottom-10! m-0! h-18.25! w-25.75! rounded-lg! border-[0.5px]! border-divider-subtle! bg-background-default-subtle! shadow-md! shadow-shadow-shadow-5!"
            />
          )}
          <ZoomInOut
            showMiniMap={showMiniMap}
            onToggleMiniMap={handleToggleMiniMap}
            showUserCursors={showUserCursors}
            onToggleUserCursors={handleToggleUserCursors}
            showUserComments={showUserComments}
            onToggleUserComments={handleToggleUserComments}
            isCommentMode={isCommentMode}
          />
        </div>
      </div>
      <VariableInspectPanel />
    </div>
  )
}

export default memo(Operator)
