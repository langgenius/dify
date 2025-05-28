import type { FC } from 'react'
import type { SchemaRoot } from '../../../types'
import SchemaNode from './schema-node'
import { useSchemaNodeOperations } from './hooks'

export type VisualEditorProps = {
  schema: SchemaRoot
  readOnly?: boolean
  onChange?: (schema: SchemaRoot) => void
}

const VisualEditor: FC<VisualEditorProps> = (props) => {
  const { schema, readOnly } = props
  useSchemaNodeOperations(props)

  return (
    <div className='h-full overflow-auto rounded-xl bg-background-section-burn p-1 pl-2'>
      <SchemaNode
        name='structured_output'
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
