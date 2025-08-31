import React, { type FC } from 'react'
import CodeEditor from './code-editor'
import cn from '@/utils/classnames'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
  hideTopMenu?: boolean
  className?: string
  readonly?: boolean
  onFocus?: () => void
  onBlur?: () => void
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
  hideTopMenu,
  className,
  readonly = false,
  onFocus,
  onBlur,
}) => {
  return (
    <CodeEditor
      readOnly={readonly}
      className={cn('grow rounded-xl', className)}
      editorWrapperClassName='grow'
      value={schema}
      onUpdate={onUpdate}
      hideTopMenu={hideTopMenu}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
}

export default SchemaEditor
