import type { AppDescribeInfo, AppDescribeResponse } from '@dify/contracts/api/openapi/types.gen'

export const FieldInfo = 'info'
export const FieldParameters = 'parameters'
export const FieldInputSchema = 'input_schema'

export type AppMetaFieldKey = typeof FieldInfo | typeof FieldParameters | typeof FieldInputSchema

export type AppMeta = {
  info: AppDescribeInfo | null
  parameters: unknown
  inputSchema: unknown
  coveredFields: ReadonlySet<AppMetaFieldKey>
}

export type AppMetaCacheRecord = {
  meta: AppMeta
  fetchedAt: string
}

export function fromDescribe(resp: AppDescribeResponse, requested: readonly AppMetaFieldKey[]): AppMeta {
  const covered = new Set<AppMetaFieldKey>()
  if (requested.length === 0) {
    covered.add(FieldInfo)
    covered.add(FieldParameters)
    covered.add(FieldInputSchema)
  }
  else {
    for (const f of requested) covered.add(f)
  }
  return {
    info: resp.info ?? null,
    parameters: resp.parameters,
    inputSchema: resp.input_schema,
    coveredFields: covered,
  }
}

export function mergeMeta(prev: AppMeta | undefined, next: AppMeta): AppMeta {
  if (prev === undefined)
    return next
  const merged = new Set<AppMetaFieldKey>(prev.coveredFields)
  for (const f of next.coveredFields) merged.add(f)
  return {
    info: next.coveredFields.has(FieldInfo) ? next.info : prev.info,
    parameters: next.coveredFields.has(FieldParameters) ? next.parameters : prev.parameters,
    inputSchema: next.coveredFields.has(FieldInputSchema) ? next.inputSchema : prev.inputSchema,
    coveredFields: merged,
  }
}

export function covers(meta: AppMeta, fields: readonly AppMetaFieldKey[]): boolean {
  if (fields.length === 0) {
    return meta.coveredFields.has(FieldInfo)
      && meta.coveredFields.has(FieldParameters)
      && meta.coveredFields.has(FieldInputSchema)
  }
  for (const f of fields) {
    if (!meta.coveredFields.has(f))
      return false
  }
  return true
}
