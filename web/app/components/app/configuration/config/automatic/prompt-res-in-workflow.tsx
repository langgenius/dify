'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum } from '@/app/components/workflow/types'
import PromptRes from './prompt-res'

type Props = {
  value: string
  nodeId: string
}

const PromptResInWorkflow: FC<Props> = ({
  value,
  nodeId,
}) => {
  const { t } = useTranslation()
  const {
    availableVars,
    availableNodes,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: _payload => true,
  })
  return (
    <PromptRes
      value={value}
      workflowVariableBlock={{
        show: true,
        variables: availableVars || [],
        getVarType: () => Type.string,
        workflowNodesMap: availableNodes.reduce((acc, node) => {
          acc[node.id] = {
            title: node.data.title,
            type: node.data.type,
            width: node.width,
            height: node.height,
            position: node.position,
          }
          if (node.data.type === BlockEnum.Start) {
            acc.sys = {
              title: t('blocks.start', { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {} as any),
      }}
    >
    </PromptRes>
  )
}
export default React.memo(PromptResInWorkflow)
