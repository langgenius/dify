import { memo } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { useStore } from '../../../store'
import type { VariableAssignerNodeType } from '../types'
import {
  useGetAvailableVars,
  useVariableAssigner,
} from '../hooks'
import NodeHandle from './node-handle'
import NodeVariableItem from './node-variable-item'
import type {
  Node,
  ValueSelector,
} from '@/app/components/workflow/types'

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
  const hoveringAssignVariableGroupId = useStore(s => s.hoveringAssignVariableGroupId)
  const nodes = useNodes()
  const {
    handleGroupItemMouseEnter,
    handleGroupItemMouseLeave,
  } = useVariableAssigner()
  const getAvailableVars = useGetAvailableVars()
  const availableVars = getAvailableVars(item.variableAssignerNodeId, item.targetHandleId)
  const showSelectionBorder = item.groupEnabled && item.variableAssignerNodeData._isEntering && hoveringAssignVariableGroupId === item.targetHandleId

  return (
    <div
      className={cn(
        'relative pt-1 px-1.5 pb-1.5 rounded-lg border border-transparent',
        showSelectionBorder && '!border-primary-600',
      )}
      onMouseEnter={() => handleGroupItemMouseEnter(item.targetHandleId)}
      onMouseLeave={handleGroupItemMouseLeave}
    >
      <div className='flex items-center justify-between h-4 text-[10px] font-medium text-gray-500'>
        <NodeHandle
          variableAssignerNodeId={item.variableAssignerNodeId}
          handleId={item.targetHandleId}
          availableVars={availableVars}
        />
        <span className='grow uppercase truncate' title={item.title}>{item.title}</span>
        <span className='shrink-0 ml-2'>{item.type}</span>
      </div>
      {
        !item.variables.length && (
          <div className='relative flex items-center px-1 h-[22px] justify-between bg-gray-100 rounded-md space-x-1 text-[10px] font-normal text-gray-400 uppercase'>
            {t(`${i18nPrefix}.varNotSet`)}
          </div>
        )
      }
      {
        !!item.variables.length && item.variables.map((variable, index) => {
          const node = nodes.find(node => node.id === variable[0])!
          const varName = variable[variable.length - 1]

          return (
            <NodeVariableItem
              key={index}
              node={node as Node}
              varName={varName}
            />
          )
        })
      }
    </div>
  )
}

export default memo(NodeGroupItem)
