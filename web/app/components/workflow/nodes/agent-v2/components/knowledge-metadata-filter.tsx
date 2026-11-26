import type { ComponentProps } from 'react'
import type { Var } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import { VarType } from '@/app/components/workflow/types'

const filterStringVar = (variable: Var) => variable.type === VarType.string
const filterNumberVar = (variable: Var) => variable.type === VarType.number

export function WorkflowAgentMetadataFilter({
  nodeId,
  ...props
}: ComponentProps<typeof MetadataFilter> & { nodeId: string }) {
  const strings = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: filterStringVar,
  })
  const numbers = useAvailableVarList(nodeId, {
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
