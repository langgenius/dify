'use client'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import type { FC } from 'react'
import React from 'react'
import PromptRes from './prompt-res'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'

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
              title: t('workflow.blocks.start'),
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
