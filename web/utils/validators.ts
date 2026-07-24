import type { Schema } from 'jsonschema'
import { Validator } from 'jsonschema'
import draft07Schema from './draft-07.json'

const validator = new Validator()

export const draft07Validator = (schema: any) => {
  return validator.validate(schema, draft07Schema as unknown as Schema)
}

export const forbidBooleanProperties = (schema: any, path: string[] = []): string[] => {
  let errors: string[] = []

  if (schema && typeof schema === 'object' && schema.properties) {
    for (const [key, val] of Object.entries(schema.properties)) {
      if (typeof val === 'boolean') {
        errors.push(
          `Error: Property '${[...path, key].join('.')}' must not be a boolean schema`,
        )
      }
      else if (typeof val === 'object') {
        errors = errors.concat(forbidBooleanProperties(val, [...path, key]))
      }
    }
  }
  return errors
}
