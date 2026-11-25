export type InputField = {
  name: string
  type: string
}

const INDEX_FIELD_NAME = 'index'

export const DATASET_TEMPLATE_FIELDS: InputField[] = [
  { name: INDEX_FIELD_NAME, type: 'number' },
  { name: 'query', type: 'string' },
  { name: 'expected_output', type: 'string' },
]

export const getFileExtension = (fileName: string) => {
  const extension = fileName.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : ''
}

// Examples show raw dataset cell values, so they must stay parseable by the backend in every locale.
export const getExampleValue = (field: InputField) => {
  if (field.name === INDEX_FIELD_NAME) return '1'

  if (field.type === 'number') return '0.7'

  if (field.type === 'boolean') return 'true'

  return field.name
}
