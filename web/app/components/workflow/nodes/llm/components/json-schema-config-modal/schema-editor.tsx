import React, { type FC } from 'react'
import CodeEditor from './code-editor'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
}) => {
  return (
    <CodeEditor
      className='rounded-xl'
      editorWrapperClassName='grow'
      value={schema}
      onUpdate={onUpdate}
    />
  )
}

export default SchemaEditor
