'use client'
import type { FC } from 'react'
import * as React from 'react'
import {
  VariableLabelInText,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { cn } from '@/utils/classnames'
import { useWorkflow } from '../../../hooks'
import { BlockEnum } from '../../../types'
import { getNodeInfoById, isSystemVar } from './variable/utils'

type Props = {
  nodeId: string
  value: string
  className?: string
}

const VAR_PLACEHOLDER = '@#!@#!'

const ReadonlyInputWithSelectVar: FC<Props> = ({
  nodeId,
  value,
  className,
}) => {
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranchIncludeParent(nodeId)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const res = (() => {
    const vars: string[] = []
    const strWithVarPlaceholder = value.replaceAll(/\{\{#([^#]*)#\}\}/g, (_match, p1) => {
      vars.push(p1)
      return VAR_PLACEHOLDER
    })

    const html: React.JSX.Element[] = strWithVarPlaceholder.split(VAR_PLACEHOLDER).map((str, index) => {
      if (!vars[index])
        return <span className="relative top-[-3px] leading-[16px]" key={index}>{str}</span>

      const value = vars[index].split('.')
      const isSystem = isSystemVar(value)
      const node = (isSystem ? startNode : getNodeInfoById(availableNodes, value[0]))?.data
      const isShowAPart = value.length > 2

      return (
        <span key={index}>
          <span className="relative top-[-3px] leading-[16px]">{str}</span>
          <VariableLabelInText
            nodeTitle={node?.title}
            nodeType={node?.type}
            notShowFullPath={isShowAPart}
            variables={value}
          />
        </span>
      )
    })
    return html
  })()

  return (
    <div className={cn('break-all text-xs', className)}>
      {res}
    </div>
  )
}
export default React.memo(ReadonlyInputWithSelectVar)
