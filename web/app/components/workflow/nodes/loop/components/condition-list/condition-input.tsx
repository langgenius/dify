import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import PromptEditor from '@/app/components/base/prompt-editor'
import { BlockEnum } from '@/app/components/workflow/types'
import type {
  Node,
} from '@/app/components/workflow/types'

type ConditionInputProps = {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  availableNodes: Node[]
}
const ConditionInput = ({
  value,
  onChange,
  disabled,
  availableNodes,
}: ConditionInputProps) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const pipelineId = useStore(s => s.pipelineId)
  const setShowInputFieldPanel = useStore(s => s.setShowInputFieldPanel)

  return (
    <PromptEditor
      key={controlPromptEditorRerenderKey}
      compact
      value={value}
      placeholder={t('workflow.nodes.ifElse.enterValue') || ''}
      workflowVariableBlock={{
        show: true,
        variables: [],
        workflowNodesMap: availableNodes.reduce((acc, node) => {
          acc[node.id] = {
            title: node.data.title,
            type: node.data.type,
          }
          if (node.data.type === BlockEnum.Start) {
            acc.sys = {
              title: t('workflow.blocks.start'),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {} as any),
        showManageInputField: !!pipelineId,
        onManageInputField: () => setShowInputFieldPanel?.(true),
      }}
      onChange={onChange}
      editable={!disabled}
    />
  )
}

export default ConditionInput
