import {
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useClickAway } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'
import {
  useIsChatMode,
  useNodeDataUpdate,
  useWorkflow,
} from '../../../hooks'
import type {
  ValueSelector,
  Var,
  VarType,
} from '../../../types'
import { useVariableAssigner } from '../../variable-assigner/hooks'
import { filterVar } from '../../variable-assigner/utils'
import AddVariablePopup from './add-variable-popup'
import { toNodeAvailableVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'

type AddVariablePopupWithPositionProps = {
  nodeId: string
  nodeData: any
}
const AddVariablePopupWithPosition = ({
  nodeId,
  nodeData,
}: AddVariablePopupWithPositionProps) => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const showAssignVariablePopup = useStore(s => s.showAssignVariablePopup)
  const setShowAssignVariablePopup = useStore(s => s.setShowAssignVariablePopup)
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleAddVariableInAddVariablePopupWithPosition } = useVariableAssigner()
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()

  const outputType = useMemo(() => {
    if (!showAssignVariablePopup)
      return ''

    if (showAssignVariablePopup.variableAssignerNodeHandleId === 'target')
      return showAssignVariablePopup.variableAssignerNodeData.output_type

    const group = showAssignVariablePopup.variableAssignerNodeData.advanced_settings?.groups.find(group => group.groupId === showAssignVariablePopup.variableAssignerNodeHandleId)
    return group?.output_type || ''
  }, [showAssignVariablePopup])
  const availableVars = useMemo(() => {
    if (!showAssignVariablePopup)
      return []

    return toNodeAvailableVars({
      parentNode: showAssignVariablePopup.parentNode,
      t,
      beforeNodes: [
        ...getBeforeNodesInSameBranch(showAssignVariablePopup.nodeId),
        {
          id: showAssignVariablePopup.nodeId,
          data: showAssignVariablePopup.nodeData,
        } as any,
      ],
      isChatMode,
      filterVar: filterVar(outputType as VarType),
    })
  }, [getBeforeNodesInSameBranch, isChatMode, showAssignVariablePopup, t, outputType])

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
