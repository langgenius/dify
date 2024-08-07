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
  useWorkflowVariables,
} from '../../../hooks'
import type {
  ValueSelector,
  Var,
  VarType,
} from '../../../types'
import { useVariableAssigner } from '../../variable-assigner/hooks'
import { filterVar } from '../../variable-assigner/utils'
import AddVariablePopup from './add-variable-popup'

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
  const { getNodeAvailableVars } = useWorkflowVariables()

  const outputType = useMemo(() => {
    if (!showAssignVariablePopup)
      return ''

    const groupEnabled = showAssignVariablePopup.variableAssignerNodeData.advanced_settings?.group_enabled

    if (!groupEnabled)
      return showAssignVariablePopup.variableAssignerNodeData.output_type

    const group = showAssignVariablePopup.variableAssignerNodeData.advanced_settings?.groups.find(group => group.groupId === showAssignVariablePopup.variableAssignerNodeHandleId)
    return group?.output_type || ''
  }, [showAssignVariablePopup])
  const availableVars = useMemo(() => {
    if (!showAssignVariablePopup)
      return []

    return getNodeAvailableVars({
      parentNode: showAssignVariablePopup.parentNode,
      beforeNodes: [
        ...getBeforeNodesInSameBranch(showAssignVariablePopup.nodeId),
        {
          id: showAssignVariablePopup.nodeId,
          data: showAssignVariablePopup.nodeData,
        } as any,
      ],
      hideEnv: true,
      isChatMode,
      filterVar: filterVar(outputType as VarType),
    })
      .map(node => ({
        ...node,
        vars: node.isStartNode ? node.vars.filter(v => !v.variable.startsWith('sys.')) : node.vars,
      }))
      .filter(item => item.vars.length > 0)
  }, [showAssignVariablePopup, getNodeAvailableVars, getBeforeNodesInSameBranch, isChatMode, outputType])

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

  const handleAddVariable = useCallback((value: ValueSelector, varDetail: Var) => {
    if (showAssignVariablePopup) {
      handleAddVariableInAddVariablePopupWithPosition(
        showAssignVariablePopup.nodeId,
        showAssignVariablePopup.variableAssignerNodeId,
        showAssignVariablePopup.variableAssignerNodeHandleId,
        value,
        varDetail,
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
