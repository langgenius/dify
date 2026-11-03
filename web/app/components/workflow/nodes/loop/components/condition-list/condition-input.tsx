import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import type { Node } from '@/app/components/workflow/types'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { editorResourceKindAtom } from '@/app/components/workflow/editor-resource/state'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

type ConditionInputProps = {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  availableNodes: Node[]
}
const ConditionInput = ({ value, onChange, disabled, availableNodes }: ConditionInputProps) => {
  const { t } = useTranslation(['workflow', 'workflowLogic'])
  const controlPromptEditorRerenderKey = useStore((s) => s.controlPromptEditorRerenderKey)
  const resourceKind = useAtomValue(editorResourceKindAtom)
  const setShowInputFieldPanel = useStore((s) => s.setShowInputFieldPanel)

  return (
    <PromptEditor
      key={controlPromptEditorRerenderKey}
      compact
      value={value}
      placeholder={t(($) => $['nodes.ifElse.enterValue'], { ns: 'workflowLogic' }) || ''}
      workflowVariableBlock={{
        show: true,
        variables: [],
        workflowNodesMap: availableNodes.reduce<WorkflowNodesMap>((acc, node) => {
          acc[node.id] = {
            title: node.data.title,
            type: node.data.type,
          }
          if (node.data.type === BlockEnum.Start) {
            acc.sys = {
              title: t(($) => $['blocks.start'], { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {}),
        showManageInputField: resourceKind === 'knowledge-pipeline',
        onManageInputField: () => setShowInputFieldPanel?.(true),
      }}
      onChange={onChange}
      editable={!disabled}
    />
  )
}

export default ConditionInput
