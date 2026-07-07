import type { BlockEnum } from '@/app/components/workflow/types'
import { memo } from 'react'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'

type VariableNodeLabelProps = {
  nodeType?: BlockEnum
  nodeTitle?: string
}
const VariableNodeLabel = ({
  nodeType,
  nodeTitle,
}: VariableNodeLabelProps) => {
  if (!nodeType)
    return null

  return (
    <>
      <VarBlockIcon
        type={nodeType}
        className="shrink-0 text-text-secondary"
      />
      {
        nodeTitle && (
          <div
            className="max-w-[60px] truncate system-xs-medium text-text-secondary"
            title={nodeTitle}
          >
            {nodeTitle}
          </div>
        )
      }
      <div className="shrink-0 system-xs-regular text-divider-deep">/</div>
    </>
  )
}

export default memo(VariableNodeLabel)
