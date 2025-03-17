import type { FC } from 'react'
import type { Field } from '../../../types'
import SchemaNode from './schema-node'

type VisualEditorProps = {
  schema: Field
}

const VisualEditor: FC<VisualEditorProps> = ({
  schema,
}) => {
  return (
    <div className='h-full rounded-xl p-1 pl-2 bg-background-section-burn overflow-auto'>
      <SchemaNode
        name='structured_output'
        schema={schema}
        required={false}
        path={[]}
        depth={0}
      />
    </div>
  )
}

export default VisualEditor
