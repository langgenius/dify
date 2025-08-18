import React, { type FC } from 'react'
import CodeEditor from './code-editor'
import cn from '@/utils/classnames'
import LargeDataAlert from '@/app/components/workflow/variable-inspect/large-data-alert'

type SchemaEditorProps = {
  schema: string
  onUpdate: (schema: string) => void
  hideTopMenu?: boolean
  className?: string
  readonly?: boolean
  isTruncated?: boolean
}

const SchemaEditor: FC<SchemaEditorProps> = ({
  schema,
  onUpdate,
  hideTopMenu,
  className,
  readonly = false,
  isTruncated,
}) => {
  return (
    <CodeEditor
      readOnly={readonly}
      className={cn('grow rounded-xl', className)}
      editorWrapperClassName='grow'
      value={schema}
      onUpdate={onUpdate}
      hideTopMenu={hideTopMenu}
      topContent={isTruncated && <LargeDataAlert className='mx-1 mb-3 mt-[-4px]' />}
    />
  )
}

export default SchemaEditor
