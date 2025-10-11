import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DocExtractorNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { useFindNode } from '@/app/components/workflow/hooks/use-find-node'

const i18nPrefix = 'workflow.nodes.docExtractor'

const NodeComponent: FC<NodeProps<DocExtractorNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()
  const { variable_selector: variable } = data
  const node = useFindNode(variable)

  if (!variable || variable.length === 0)
    return null

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
