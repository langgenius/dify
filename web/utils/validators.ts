import Ajv, { type SchemaValidateFunction } from 'ajv'

const ajv = new Ajv({
  strict: true,
  strictSchema: true,
  allErrors: true,
  code: { source: false },
})

const validation: SchemaValidateFunction = (flag: boolean, schemaObj: any): boolean => {
  if (!flag) return true

  if (schemaObj && schemaObj.properties) {
    for (const key of Object.keys(schemaObj.properties)) {
      const val = schemaObj.properties[key]
      if (typeof val === 'boolean') {
        validation.errors = [
          {
            keyword: 'noBooleanProps',
            instancePath: `/properties/${key}`,
            schemaPath: '#/noBooleanProps',
            params: { property: key },
            message: `Boolean schema not allowed in properties ("${key}")`,
          },
        ]
        return false
      }
    }
  }
  return true
}

ajv.addKeyword({
  keyword: 'noBooleanProps',
  type: 'object',
  schemaType: 'boolean',
  validate: validation,
  errors: true,
})

const draft7MetaSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  noBooleanProps: true,
}

const validateDraft7 = ajv.compile(draft7MetaSchema)

export { validateDraft7 }
