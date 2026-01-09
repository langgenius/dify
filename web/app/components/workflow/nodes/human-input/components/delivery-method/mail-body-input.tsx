import PromptEditor from '@/app/components/base/prompt-editor'
import Placeholder from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input/placeholder'
import { cn } from '@/utils/classnames'

type MailBodyInputProps = {
  readOnly?: boolean
  value?: string
  onChange?: (text: string) => void
}

const MailBodyInput = ({
  readOnly = false,
  value = '',
  onChange,
}: MailBodyInputProps) => {
  return (
    <PromptEditor
      wrapperClassName={cn(
        'w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className="caret:text-text-accent min-h-[128px]"
      editable={!readOnly}
      value={value}
      requestURLBlock={{
        show: true,
        selectable: true,
      }}
      placeholder={<Placeholder hideBadge />}
      onChange={onChange}
    />
  )
}

export default MailBodyInput
