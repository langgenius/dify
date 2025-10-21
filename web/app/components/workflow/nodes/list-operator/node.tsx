import type { FC } from 'react'
import React from 'react'
import { useNodes } from 'reactflow'
import { useTranslation } from 'react-i18next'
import type { ListFilterNodeType } from './types'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, type Node, type NodeProps } from '@/app/components/workflow/types'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

const i18nPrefix = 'workflow.nodes.listFilter'

const NodeComponent: FC<NodeProps<ListFilterNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  const nodes: Node[] = useNodes()
  const { variable } = data

  if (!variable || variable.length === 0)
    return null

  const isSystem = isSystemVar(variable)
  const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
  return (
    <div className='relative px-3'>
      <div className='system-2xs-medium-uppercase mb-1 text-text-tertiary'>{t(`${i18nPrefix}.inputVar`)}</div>
      <VariableLabelInNode
        variables={variable}
        nodeType={node?.data.type}
        nodeTitle={node?.data.title}
      />
    </div>
  )
}

export default React.memo(NodeComponent)
