import type { ComponentProps } from 'react'
import type { Var } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import { VarType } from '@/app/components/workflow/types'

type Props = ComponentProps<typeof MetadataFilter> & {
  workflowNodeId?: string
}

const filterStringVar = (variable: Var) => variable.type === VarType.string
const filterNumberVar = (variable: Var) => variable.type === VarType.number

function WorkflowMetadataFilter({ workflowNodeId, ...props }: Props & { workflowNodeId: string }) {
  const strings = useAvailableVarList(workflowNodeId, {
    onlyLeafNodeVar: false,
    filterVar: filterStringVar,
  })
  const numbers = useAvailableVarList(workflowNodeId, {
    onlyLeafNodeVar: false,
    filterVar: filterNumberVar,
  })

  return (
    <MetadataFilter
      {...props}
      availableStringVars={strings.availableVars}
      availableStringNodesWithParent={strings.availableNodesWithParent}
      availableNumberVars={numbers.availableVars}
      availableNumberNodesWithParent={numbers.availableNodesWithParent}
    />
  )
}

export function AgentMetadataFilter({ workflowNodeId, ...props }: Props) {
  // Standalone Agent composers do not have a workflow canvas or variable scope.
  if (workflowNodeId) return <WorkflowMetadataFilter {...props} workflowNodeId={workflowNodeId} />

  return <MetadataFilter {...props} />
}
