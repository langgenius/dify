import type { Schema, ValidationError, ValidatorResult } from 'jsonschema'
import { Validator } from 'jsonschema'
import draft07Schema from './draft-07.json'

const validator = new Validator()

type Draft07ValidationResult = Pick<ValidatorResult, 'valid' | 'errors'>

export const draft07Validator = (schema: any): Draft07ValidationResult => {
  try {
    return validator.validate(schema, draft07Schema as unknown as Schema)
  } catch {
    // The jsonschema library may throw URL errors in browser environments
    // when resolving schema $id URIs. Return empty errors since structural
    // validation is handled separately by preValidateSchema (#34841).
    return { valid: true, errors: [] as ValidationError[] }
  }
}

export const forbidBooleanProperties = (schema: any, path: string[] = []): string[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  let errors: string[] = []

  if (schema.properties) {
    for (const [key, val] of Object.entries(schema.properties)) {
      if (typeof val === 'boolean') {
        errors.push(`Error: Property '${[...path, key].join('.')}' must not be a boolean schema`)
      } else if (typeof val === 'object') {
        errors = errors.concat(forbidBooleanProperties(val, [...path, key]))
      }
    }
  }

  // Traverse schema containers only. Annotation/data keywords such as default,
  // examples, const and enum may contain objects that are not schemas.
  for (const keyword of [
    'items',
    'additionalItems',
    'contains',
    'additionalProperties',
    'propertyNames',
    'not',
    'if',
    'then',
    'else',
    'allOf',
    'anyOf',
    'oneOf',
  ]) {
    const child = schema[keyword]
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        errors = errors.concat(forbidBooleanProperties(item, [...path, keyword, String(index)]))
      })
    } else if (child !== undefined) {
      errors = errors.concat(forbidBooleanProperties(child, [...path, keyword]))
    }
  }

  for (const keyword of ['definitions', '$defs', 'patternProperties', 'dependencies']) {
    const children = schema[keyword]
    if (children && typeof children === 'object' && !Array.isArray(children)) {
      for (const [name, child] of Object.entries(children))
        errors = errors.concat(forbidBooleanProperties(child, [...path, keyword, name]))
    }
  }
  return errors
}
