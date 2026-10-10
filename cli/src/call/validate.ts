import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020'
import type { JsonSchema } from '@/plugins/catalog'
import Ajv2020 from 'ajv/dist/2020'

export type ValidationDetail = {
  readonly type: string
  readonly loc: (string | number)[]
  readonly msg: string
}

// One shared Ajv instance: schemas come from a trusted, already-parsed catalog, so
// $data is never enabled and formats are left to the server (validateFormats: false).
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
const compiled = new WeakMap<JsonSchema, ValidateFunction>()

function compile(schema: JsonSchema): ValidateFunction {
  const cached = compiled.get(schema)
  if (cached !== undefined) return cached
  const validate = ajv.compile(schema)
  compiled.set(schema, validate)
  return validate
}

function locFor(error: ErrorObject): (string | number)[] {
  const loc = error.instancePath.split('/').filter(Boolean)
  if (error.keyword === 'required') {
    const missingProperty = (error.params as { missingProperty?: string }).missingProperty
    if (missingProperty !== undefined) loc.push(missingProperty)
  }
  return loc
}

function toDetail(error: ErrorObject): ValidationDetail {
  return { type: error.keyword, loc: locFor(error), msg: error.message ?? error.keyword }
}

export function validateInput(schema: JsonSchema, input: unknown): readonly ValidationDetail[] {
  const validate = compile(schema)
  if (validate(input) || validate.errors == null) return []
  return validate.errors.map(toDetail)
}
