import type { FC } from 'react'
import type { AssignerNodeType } from './types'
import type { OperationName } from './utils'
import type { Node, NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import Badge from '@/app/components/base/badge'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { BlockEnum } from '@/app/components/workflow/types'

const i18nPrefix = 'nodes.assigner'

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
        <div className="relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1">
          <div className="flex flex-col items-start gap-1 self-stretch">
            <div className="flex items-center gap-1 self-stretch rounded-md bg-workflow-block-parma-bg px-[5px] py-1">
              <div className="system-xs-medium flex-1 text-text-tertiary">{t(`${i18nPrefix}.varNotSet`, { ns: 'workflow' })}</div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1">
        {operationItems.map((value, index) => {
          const variable = value.variable_selector
          if (!variable || variable.length === 0)
            return null
          const isSystem = isSystemVar(variable)
          const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
          return (
            <VariableLabelInNode
              key={index}
              variables={variable}
              nodeType={node?.data.type}
              nodeTitle={node?.data.title}
              rightSlot={
                !!value.operation && <Badge className="!ml-auto shrink-0" text={t(`${i18nPrefix}.operations.${value.operation}`, { ns: 'workflow' })} />
              }
            />
          )
        })}
      </div>
    )
  }
  // Legacy version
  type LegacyAssignerNodeType = { assigned_variable_selector: string[], write_mode: OperationName }
  const { assigned_variable_selector: variable, write_mode: writeMode } = data as unknown as LegacyAssignerNodeType

  if (!variable || variable.length === 0)
    return null
  const isSystem = isSystemVar(variable)
  const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])

  return (
    <div className="relative flex flex-col items-start gap-0.5 self-stretch px-3 py-1">
      <VariableLabelInNode
        variables={variable}
        nodeType={node?.data.type}
        nodeTitle={node?.data.title}
        rightSlot={
          writeMode && <Badge className="!ml-auto shrink-0" text={t(`nodes.assigner.operations.${writeMode}`, { ns: 'workflow' })} />
        }
      />
    </div>
  )
}

export default React.memo(NodeComponent)
