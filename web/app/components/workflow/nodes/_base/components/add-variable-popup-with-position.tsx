import {
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useClickAway } from 'ahooks'
import { useStore } from '../../../store'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '../../../hooks'
import type { ValueSelector } from '../../../types'
import { useVariableAssigner } from '../../variable-assigner/hooks'
import AddVariablePopup from './add-variable-popup'
import { toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

type AddVariablePopupWithPositionProps = {
  nodeId: string
  nodeData: any
}
const AddVariablePopupWithPosition = ({
  nodeId,
  nodeData,
}: AddVariablePopupWithPositionProps) => {
  const ref = useRef(null)
  const showAssignVariablePopup = useStore(s => s.showAssignVariablePopup)
  const setShowAssignVariablePopup = useStore(s => s.setShowAssignVariablePopup)
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleAddVariableInAddVariablePopupWithPosition } = useVariableAssigner()
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()

  const availableVars = useMemo(() => {
    if (!showAssignVariablePopup)
      return []

    return toNodeOutputVars([{
      id: showAssignVariablePopup.nodeId,
      data: showAssignVariablePopup.nodeData,
    }, ...getBeforeNodesInSameBranch(showAssignVariablePopup.nodeId)], isChatMode)
  }, [getBeforeNodesInSameBranch, isChatMode, showAssignVariablePopup])

  useClickAway(() => {
    if (nodeData._holdAddVariablePopup) {
      handleNodeDataUpdate({
        id: nodeId,
        data: {
          _holdAddVariablePopup: false,
        },
      })
    }
    else {
      handleNodeDataUpdate({
        id: nodeId,
        data: {
          _showAddVariablePopup: false,
        },
      })
      setShowAssignVariablePopup(undefined)
    }
  }, ref)

  const handleAddVariable = useCallback((value: ValueSelector) => {
    if (showAssignVariablePopup) {
      handleAddVariableInAddVariablePopupWithPosition(
        showAssignVariablePopup.nodeId,
        showAssignVariablePopup.variableAssignerNodeId,
        showAssignVariablePopup.variableAssignerNodeHandleId,
        value,
      )
    }
  }, [showAssignVariablePopup, handleAddVariableInAddVariablePopupWithPosition])

  if (!showAssignVariablePopup)
    return null

  return (
    <div
      className='absolute z-10'
      style={{
        left: showAssignVariablePopup.x,
        top: showAssignVariablePopup.y,
      }}
      ref={ref}
    >
      <AddVariablePopup
        availableVars={availableVars}
        onSelect={handleAddVariable}
      />
    </div>
  )
}

export default memo(AddVariablePopupWithPosition)
