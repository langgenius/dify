import React, { type FC } from 'react'
import CodeEditor from './code-editor'
import cn from '@/utils/classnames'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
  hideTopMenu?: boolean
  className?: string
  readonly?: boolean
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
  hideTopMenu,
  className,
  readonly = false,
}) => {
  return (
    <CodeEditor
      readOnly={readonly}
      className={cn('grow rounded-xl', className)}
      editorWrapperClassName='grow'
      value={schema}
      onUpdate={onUpdate}
      hideTopMenu={hideTopMenu}
    />
  )
}

export default SchemaEditor
