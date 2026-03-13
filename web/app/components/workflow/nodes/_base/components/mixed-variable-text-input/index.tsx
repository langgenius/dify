import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import Placeholder from './placeholder'

type MixedVariableTextInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  value?: string
  onChange?: (text: string) => void
}
const MixedVariableTextInput = ({
  readOnly = false,
  nodesOutputVars,
  availableNodes = [],
  value = '',
  onChange,
}: MixedVariableTextInputProps) => {
  const { t } = useTranslation()
  return (
    <PromptEditor
      wrapperClassName={cn(
        'w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className="caret:text-text-accent"
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
              title: t('blocks.start', { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {} as any),
      }}
      placeholder={<Placeholder />}
      onChange={onChange}
    />
  )
}

export default memo(MixedVariableTextInput)
