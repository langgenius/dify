import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import Placeholder from './placeholder'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import { useStore } from '@/app/components/workflow/store'

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  value?: string
  onChange?: (text: string) => void
  showManageInputField?: boolean
  onManageInputField?: () => void
}
const MixedVariableTextInput = ({
  readOnly = false,
  nodesOutputVars,
  availableNodes = [],
  value = '',
  onChange,
  showManageInputField,
  onManageInputField,
}: MixedVariableTextInputProps) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)

  return (
    <PromptEditor
      key={controlPromptEditorRerenderKey}
      wrapperClassName={cn(
        'w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className='caret:text-text-accent'
      editable={!readOnly}
      value={value}
      workflowVariableBlock={{
        show: true,
        variables: nodesOutputVars || [],
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
        showManageInputField,
        onManageInputField,
      }}
      placeholder={<Placeholder />}
      onChange={onChange}
    />
  )
}

export default memo(MixedVariableTextInput)
