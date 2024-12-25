import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { useStore } from '../../../store'
import { BlockEnum } from '../../../types'
import type {
  Node,
  ValueSelector,
  VarType,
} from '../../../types'
import type { VariableAssignerNodeType } from '../types'
import {
  useGetAvailableVars,
  useVariableAssigner,
} from '../hooks'
import { filterVar } from '../utils'
import AddVariable from './add-variable'
import NodeVariableItem from './node-variable-item'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import cn from '@/utils/classnames'
import { isExceptionVariable } from '@/app/components/workflow/utils'

const i18nPrefix = 'workflow.nodes.variableAssigner'
type GroupItem = {
  groupEnabled: boolean
  targetHandleId: string
  title: string
  type: string
  variables: ValueSelector[]
  variableAssignerNodeId: string
  variableAssignerNodeData: VariableAssignerNodeType
}
type NodeGroupItemProps = {
  item: GroupItem
}
const NodeGroupItem = ({
  item,
}: NodeGroupItemProps) => {
  const { t } = useTranslation()
  const enteringNodePayload = useStore(s => s.enteringNodePayload)
  const hoveringAssignVariableGroupId = useStore(s => s.hoveringAssignVariableGroupId)
  const nodes: Node[] = useNodes()
  const {
    handleGroupItemMouseEnter,
    handleGroupItemMouseLeave,
  } = useVariableAssigner()
  const getAvailableVars = useGetAvailableVars()
  const groupEnabled = item.groupEnabled
  const outputType = useMemo(() => {
    if (!groupEnabled)
      return item.variableAssignerNodeData.output_type

    const group = item.variableAssignerNodeData.advanced_settings?.groups.find(group => group.groupId === item.targetHandleId)
    return group?.output_type || ''
  }, [item.variableAssignerNodeData, item.targetHandleId, groupEnabled])
  const availableVars = getAvailableVars(item.variableAssignerNodeId, item.targetHandleId, filterVar(outputType as VarType), true)
  const showSelectionBorder = useMemo(() => {
    if (groupEnabled && enteringNodePayload?.nodeId === item.variableAssignerNodeId) {
      if (hoveringAssignVariableGroupId)
        return hoveringAssignVariableGroupId !== item.targetHandleId
      else
        return enteringNodePayload?.nodeData.advanced_settings?.groups[0].groupId !== item.targetHandleId
    }

    return false
  }, [enteringNodePayload, groupEnabled, hoveringAssignVariableGroupId, item.targetHandleId, item.variableAssignerNodeId])
  const showSelectedBorder = useMemo(() => {
    if (groupEnabled && enteringNodePayload?.nodeId === item.variableAssignerNodeId) {
      if (hoveringAssignVariableGroupId)
        return hoveringAssignVariableGroupId === item.targetHandleId
      else
        return enteringNodePayload?.nodeData.advanced_settings?.groups[0].groupId === item.targetHandleId
    }

    return false
  }, [enteringNodePayload, groupEnabled, hoveringAssignVariableGroupId, item.targetHandleId, item.variableAssignerNodeId])

  return (
    <div
      className={cn(
        'relative pt-1 px-1.5 pb-1.5 rounded-lg border-[1.5px] border-transparent',
        showSelectionBorder && '!border-gray-300 !border-dashed bg-black/[0.02]',
        showSelectedBorder && '!border-primary-600 !bg-primary-50',
      )}
      onMouseEnter={() => groupEnabled && handleGroupItemMouseEnter(item.targetHandleId)}
      onMouseLeave={handleGroupItemMouseLeave}
    >
      <div className='flex items-center justify-between h-4 text-[10px] font-medium text-gray-500'>
        <span
          className={cn(
            'grow uppercase truncate',
            showSelectedBorder && 'text-primary-600',
          )}
          title={item.title}
        >
          {item.title}
        </span>
        <div className='flex items-center'>
          <span className='shrink-0 ml-2'>{item.type}</span>
          <div className='ml-2 mr-1 w-[1px] h-2.5 bg-gray-200'></div>
          <AddVariable
            availableVars={availableVars}
            variableAssignerNodeId={item.variableAssignerNodeId}
            variableAssignerNodeData={item.variableAssignerNodeData}
            handleId={item.targetHandleId}
          />
        </div>
      </div>
      {
        !item.variables.length && (
          <div
            className={cn(
              'relative flex items-center px-1 h-[22px] justify-between bg-gray-100 rounded-md space-x-1 text-[10px] font-normal text-gray-400 uppercase',
              (showSelectedBorder || showSelectionBorder) && '!bg-black/[0.02]',
            )}
          >
            {t(`${i18nPrefix}.varNotSet`)}
          </div>
        )
      }
      {
        !!item.variables.length && item.variables.map((variable = [], index) => {
          const isSystem = isSystemVar(variable)
          const isEnv = isENV(variable)
          const isChatVar = isConversationVar(variable)

          const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
          const varName = isSystem ? `sys.${variable[variable.length - 1]}` : variable.slice(1).join('.')
          const isException = isExceptionVariable(varName, node?.data.type)

          return (
            <NodeVariableItem
              key={index}
              isEnv={isEnv}
              isChatVar={isChatVar}
              isException={isException}
              node={node as Node}
              varName={varName}
              showBorder={showSelectedBorder || showSelectionBorder}
            />
          )
        })
      }
    </div>
  )
}

export default memo(NodeGroupItem)
