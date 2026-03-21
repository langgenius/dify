import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import Placeholder from './placeholder'

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  value?: string
  onChange?: (text: string) => void
  showManageInputField?: boolean
  onManageInputField?: () => void
  disableVariableInsertion?: boolean
}
const MixedVariableTextInput = ({
  readOnly = false,
  nodesOutputVars,
  availableNodes = [],
  value = '',
  onChange,
  showManageInputField,
  onManageInputField,
  disableVariableInsertion = false,
}: MixedVariableTextInputProps) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)

  return (
    <PromptEditor
      key={controlPromptEditorRerenderKey}
      wrapperClassName={cn(
        'min-h-8 w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className="caret:text-text-accent"
      editable={!readOnly}
      value={value}
      workflowVariableBlock={{
        show: !disableVariableInsertion,
        variables: nodesOutputVars || [],
        workflowNodesMap: availableNodes.reduce((acc, node) => {
          acc[node.id] = {
            title: node.data.title,
            type: node.data.type,
          }
          if (node.data.type === BlockEnum.Start) {
            acc.sys = {
              title: t('blocks.start', { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {} as any),
        showManageInputField,
        onManageInputField,
      }}
      placeholder={<Placeholder disableVariableInsertion={disableVariableInsertion} />}
      onChange={onChange}
    />
  )
}

export default memo(MixedVariableTextInput)
