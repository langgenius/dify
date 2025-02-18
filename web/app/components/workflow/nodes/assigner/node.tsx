import type { FC } from 'react'
import React from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import NodeVariableItem from '../variable-assigner/components/node-variable-item'
import type { AssignerNodeType } from './types'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, type Node, type NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.assigner'

const NodeComponent: FC<NodeProps<AssignerNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  const nodes: Node[] = useNodes()
  if (data.version === '2') {
    const { items: operationItems } = data
    const validOperationItems = operationItems?.filter(item =>
      item.variable_selector && item.variable_selector.length > 0,
    ) || []

    if (validOperationItems.length === 0) {
      return (
        <div className='relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1'>
          <div className='flex flex-col items-start gap-1 self-stretch'>
            <div className='bg-workflow-block-parma-bg flex items-center gap-1 self-stretch rounded-md px-[5px] py-1'>
              <div className='text-text-tertiary system-xs-medium flex-1'>{t(`${i18nPrefix}.varNotSet`)}</div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className='relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1'>
        {operationItems.map((value, index) => {
          const variable = value.variable_selector
          if (!variable || variable.length === 0)
            return null
          const isSystem = isSystemVar(variable)
          const isEnv = isENV(variable)
          const isChatVar = isConversationVar(variable)
          const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
          const varName = isSystem ? `sys.${variable[variable.length - 1]}` : variable.slice(1).join('.')
          return (
            <NodeVariableItem
              key={index}
              node={node as Node}
              isEnv={isEnv}
              isChatVar={isChatVar}
              writeMode={value.operation}
              varName={varName}
              className='bg-workflow-block-parma-bg'
            />
          )
        })}
      </div>
    )
  }
  // Legacy version
  const { assigned_variable_selector: variable, write_mode: writeMode } = data as any

  if (!variable || variable.length === 0)
    return null
  const isSystem = isSystemVar(variable)
  const isEnv = isENV(variable)
  const isChatVar = isConversationVar(variable)

  const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
  const varName = isSystem ? `sys.${variable[variable.length - 1]}` : variable.slice(1).join('.')

  return (
    <div className='relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1'>
      <NodeVariableItem
        node={node as Node}
        isEnv={isEnv}
        isChatVar={isChatVar}
        varName={varName}
        writeMode={writeMode}
        className='bg-workflow-block-parma-bg'
      />
    </div>
  )
}

export default React.memo(NodeComponent)
