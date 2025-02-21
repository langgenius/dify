import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import PromptEditor from '@/app/components/base/prompt-editor'
import { BlockEnum } from '@/app/components/workflow/types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'

type ConditionInputProps = {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
}
const ConditionInput = ({
  value,
  onChange,
  disabled,
  nodesOutputVars,
  availableNodes,
}: ConditionInputProps) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)

  return (
    <PromptEditor
      key={controlPromptEditorRerenderKey}
      compact
      value={value}
      placeholder={t('workflow.nodes.ifElse.enterValue') || ''}
      workflowVariableBlock={{
        show: true,
        variables: nodesOutputVars || [],
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
      onChange={onChange}
      editable={!disabled}
    />
  )
}

export default ConditionInput
