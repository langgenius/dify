import {
  memo,
} from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'
import { cn } from '@/utils/classnames'
import Placeholder from './placeholder'

type MixedVariableTextInputProps = {
  editable?: boolean
  value?: string
  onChange?: (text: string) => void
}
const MixedVariableTextInput = ({
  editable = true,
  value = '',
  onChange,
}: MixedVariableTextInputProps) => {
  return (
    <PromptEditor
      wrapperClassName={cn(
        'rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className="caret:text-text-accent"
      editable={editable}
      value={value}
      workflowVariableBlock={{
        show: true,
        variables: [],
        workflowNodesMap: {},
      }}
      placeholder={<Placeholder />}
      onChange={onChange}
    />
  )
}

export default memo(MixedVariableTextInput)
