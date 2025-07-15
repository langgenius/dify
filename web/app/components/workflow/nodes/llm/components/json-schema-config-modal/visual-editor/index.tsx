import type { FC } from 'react'
import type { SchemaRoot } from '../../../types'
import SchemaNode from './schema-node'
import { useSchemaNodeOperations } from './hooks'
import cn from '@/utils/classnames'

export type VisualEditorProps = {
  className?: string
  schema: SchemaRoot
  rootName?: string
  readOnly?: boolean
  onChange?: (schema: SchemaRoot) => void
}

const VisualEditor: FC<VisualEditorProps> = (props) => {
  const { className, schema, readOnly } = props
  useSchemaNodeOperations(props)

  return (
    <div className={cn('h-full overflow-auto rounded-xl bg-background-section-burn p-1 pl-2', className)}>
      <SchemaNode
        name={props.rootName || 'structured_output'}
        schema={schema}
        required={false}
        path={[]}
        depth={0}
        readOnly={readOnly}
      />
    </div>
  )
}

export default VisualEditor
