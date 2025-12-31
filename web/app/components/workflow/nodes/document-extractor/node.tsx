import type { FC } from 'react'
import type { DocExtractorNodeType } from './types'
import type { Node, NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { BlockEnum } from '@/app/components/workflow/types'

const i18nPrefix = 'nodes.docExtractor'

const NodeComponent: FC<NodeProps<DocExtractorNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()

  const nodes: Node[] = useNodes()
  const { variable_selector: variable } = data

  if (!variable || variable.length === 0)
    return null

  const isSystem = isSystemVar(variable)
  const node = isSystem ? nodes.find(node => node.data.type === BlockEnum.Start) : nodes.find(node => node.id === variable[0])
  return (
    <div className="relative mb-1 px-3 py-1">
      <div className="system-2xs-medium-uppercase mb-1 text-text-tertiary">{t(`${i18nPrefix}.inputVar`, { ns: 'workflow' })}</div>
      <VariableLabelInNode
        variables={variable}
        nodeType={node?.data.type}
        nodeTitle={node?.data.title}
      />
    </div>
  )
}

export default React.memo(NodeComponent)
