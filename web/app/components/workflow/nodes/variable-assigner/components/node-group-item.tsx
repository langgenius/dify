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
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import cn from '@/utils/classnames'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

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
        'relative rounded-lg border-[1.5px] border-transparent px-1.5 pb-1.5 pt-1',
        showSelectionBorder && '!border-dashed !border-divider-subtle bg-state-base-hover',
        showSelectedBorder && '!border-text-accent !bg-util-colors-blue-blue-50',
      )}
      onMouseEnter={() => groupEnabled && handleGroupItemMouseEnter(item.targetHandleId)}
      onMouseLeave={handleGroupItemMouseLeave}
    >
      <div className='flex h-4 items-center justify-between text-[10px] font-medium text-text-tertiary'>
        <span
          className={cn(
            'grow truncate uppercase',
            showSelectedBorder && 'text-text-accent',
          )}
          title={item.title}
        >
          {item.title}
        </span>
        <div className='flex items-center'>
          <span className='ml-2 shrink-0'>{item.type}</span>
          <div className='ml-2 mr-1 h-2.5 w-[1px] bg-divider-regular'></div>
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
              'relative flex h-[22px] items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-[10px] font-normal uppercase text-text-tertiary',
              (showSelectedBorder || showSelectionBorder) && '!bg-black/[0.02]',
            )}
          >
            {t(`${i18nPrefix}.varNotSet`)}
          </div>
        )
      }
      {
        !!item.variables.length && (
          <div className='space-y-0.5'>
            {
              item.variables.map((variable = [], index) => {
                const isSystem = isSystemVar(variable)

                const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
                const varName = isSystem ? `sys.${variable[variable.length - 1]}` : variable.slice(1).join('.')
                const isException = isExceptionVariable(varName, node?.data.type)

                return (
                  <VariableLabelInNode
                    key={index}
                    variables={variable}
                    nodeType={node?.data.type}
                    nodeTitle={node?.data.title}
                    isExceptionVariable={isException}
                  />
                )
              })
            }
          </div>
        )
      }
    </div>
  )
}

export default memo(NodeGroupItem)
