export type InputField = {
  name: string
  type: string
}

export const INDEX_FIELD_NAME = 'index'

export const DATASET_TEMPLATE_FIELDS: InputField[] = [
  { name: INDEX_FIELD_NAME, type: 'number' },
  { name: 'query', type: 'string' },
  { name: 'expected_output', type: 'string' },
]

export const getFileExtension = (fileName: string) => {
  const extension = fileName.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : ''
}

export const getExampleValue = (field: InputField, booleanLabel: string) => {
  if (field.name === INDEX_FIELD_NAME) return '1'

  if (field.type === 'number') return '0.7'

  if (field.type === 'boolean') return booleanLabel

  return field.name
}
