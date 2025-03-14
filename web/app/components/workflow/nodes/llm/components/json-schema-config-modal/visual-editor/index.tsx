import type { FC } from 'react'
import type { Field } from '../../../types'
import SchemaNode from './schema-node'

type VisualEditorProps = {
  schema: Field
  onChange: (schema: Field) => void
}

const VisualEditor: FC<VisualEditorProps> = ({
  schema,
  onChange,
}) => {
  return (
    <div className='h-full rounded-xl p-1 pl-2 bg-background-section-burn'>
      <SchemaNode
        name='structured_output'
        schema={schema}
        required={false}
        onChange={onChange}
        depth={0}
      />
    </div>
  )
}

export default VisualEditor
