import type { ComponentProps } from 'react'
import type { Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useTranslation } from 'react-i18next'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import MetadataFilterSelector from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter/metadata-filter-selector'
import { VarType } from '@/app/components/workflow/types'

type Props = ComponentProps<typeof MetadataFilter> & {
  workflowNodeId?: string
  metadataUnavailable?: boolean
  onRetryMetadata?: () => void
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

export function AgentMetadataFilter({
  workflowNodeId,
  metadataUnavailable = false,
  onRetryMetadata,
  ...props
}: Props) {
  const { t } = useTranslation(['appApi', 'common'])
  // Condition editors initialize their value mode from the metadata type.
  // Mount them only once definitions are available so saved variables stay variables.
  if (props.selectedDatasetsLoaded === false) {
    if (metadataUnavailable) {
      return (
        <div className="flex flex-col gap-2 py-2">
          <span role="alert" className="body-xs-regular text-text-destructive">
            {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
          </span>
          <div className="flex items-center gap-2">
            <MetadataFilterSelector
              value={props.metadataFilterMode}
              onSelect={props.handleMetadataFilterModeChange}
            />
            <Button size="small" onClick={onRetryMetadata}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className="py-2">
        <Spinner aria-label={t(($) => $.loading, { ns: 'appApi' })} />
      </div>
    )
  }

  // Standalone Agent composers do not have a workflow canvas or variable scope.
  if (workflowNodeId) return <WorkflowMetadataFilter {...props} workflowNodeId={workflowNodeId} />

  return <MetadataFilter {...props} />
}
