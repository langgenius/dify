import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import LargeDataAlert from '@/app/components/workflow/variable-inspect/large-data-alert'
import CodeEditor from './code-editor'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
  hideTopMenu?: boolean
  className?: string
  readonly?: boolean
  onFocus?: () => void
  onBlur?: () => void
  isTruncated?: boolean
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
  hideTopMenu,
  className,
  readonly = false,
  onFocus,
  onBlur,
  isTruncated,
}) => {
  return (
    <CodeEditor
      readOnly={readonly}
      className={cn('grow rounded-xl', className)}
      editorWrapperClassName="grow"
      value={schema}
      onUpdate={onUpdate}
      hideTopMenu={hideTopMenu}
      onFocus={onFocus}
      onBlur={onBlur}
      topContent={isTruncated && <LargeDataAlert className="mx-1 mt-[-4px] mb-3" />}
    />
  )
}

export default SchemaEditor
