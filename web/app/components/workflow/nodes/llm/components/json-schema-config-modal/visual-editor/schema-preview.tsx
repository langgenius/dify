import type { Field } from '../../../types'
import SchemaNode from './schema-node'

type SchemaPreviewProps = {
  schema: Field
  rootName: string
}

export function SchemaPreview({ schema, rootName }: SchemaPreviewProps) {
  return (
    <div className="w-full rounded-xl bg-background-section-burn p-1 pl-2">
      <SchemaNode
        name={rootName || 'structured_output'}
        schema={schema}
        required={false}
        path={[]}
        depth={0}
        readOnly
      />
    </div>
  )
}
