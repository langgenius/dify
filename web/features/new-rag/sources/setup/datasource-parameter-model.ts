import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'

type Datasource = DataSourceItem['declaration']['datasources'][number]

const LEGACY_WEBSITE_PARAMETER_SCHEMAS: DatasourceParameterSchema[] = [
  {
    label: {},
    labelTranslationKey: 'rootUrl',
    name: 'url',
    options: [],
    placeholder: {},
    placeholderTranslationKey: 'rootUrlPlaceholder',
    required: true,
    type: 'string',
  },
  {
    defaultValue: true,
    label: {},
    labelTranslationKey: 'includeSubpages',
    name: 'crawl_subpages',
    options: [],
    required: false,
    type: 'boolean',
  },
  {
    defaultValue: 100,
    integer: true,
    label: {},
    labelTranslationKey: 'maxPages',
    max: 200,
    min: 1,
    name: 'limit',
    options: [],
    required: false,
    type: 'number',
  },
]

export type DatasourceParameterValue = boolean | number | string
export type DatasourceParameters = Record<string, DatasourceParameterValue>

export type DatasourceParameterOption = {
  label: Record<string, string | undefined>
  value: string
}

export type DatasourceParameterSchema = {
  defaultValue?: DatasourceParameterValue
  description?: Record<string, string | undefined>
  integer?: boolean
  label: Record<string, string | undefined>
  labelTranslationKey?: 'includeSubpages' | 'maxPages' | 'rootUrl'
  max?: number
  min?: number
  name: string
  options: DatasourceParameterOption[]
  placeholder?: Record<string, string | undefined>
  placeholderTranslationKey?: 'rootUrlPlaceholder'
  precision?: number
  required: boolean
  type: 'boolean' | 'number' | 'select' | 'string' | 'unsupported'
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function localizedText(value: unknown): Record<string, string | undefined> {
  const candidate = record(value)
  if (!candidate) return {}
  return Object.fromEntries(
    Object.entries(candidate).flatMap(([key, text]) =>
      typeof text === 'string' ? [[key, text] as const] : [],
    ),
  )
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boundedPrecision(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 20
    ? Number(value)
    : undefined
}

function parameterType(value: unknown): DatasourceParameterSchema['type'] | undefined {
  if (value === 'boolean') return 'boolean'
  if (value === 'number' || value === 'integer') return 'number'
  if (value === 'select') return 'select'
  if (value === 'string' || value === 'text-input') return 'string'
  if (['file', 'files', 'secret-input', 'system-files'].includes(String(value)))
    return 'unsupported'
}

function defaultValue(
  value: unknown,
  type: DatasourceParameterSchema['type'],
): DatasourceParameterValue | undefined {
  if (type === 'boolean' && typeof value === 'boolean') return value
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value
  if ((type === 'select' || type === 'string') && typeof value === 'string') return value
}

export function datasourceParameterSchemas(datasource: Datasource): DatasourceParameterSchema[] {
  return datasource.parameters.flatMap((rawParameter) => {
    const parameter = record(rawParameter)
    if (!parameter || typeof parameter.name !== 'string' || !parameter.name.trim()) return []
    const type = parameterType(parameter.type)
    if (!type) return []
    const options = Array.isArray(parameter.options)
      ? parameter.options.flatMap((rawOption) => {
          const option = record(rawOption)
          if (!option || typeof option.value !== 'string') return []
          return [
            {
              label: localizedText(option.label),
              value: option.value,
            },
          ]
        })
      : []
    return [
      {
        ...(defaultValue(parameter.default, type) === undefined
          ? {}
          : { defaultValue: defaultValue(parameter.default, type) }),
        description: localizedText(parameter.description),
        ...(parameter.type === 'integer' ? { integer: true } : {}),
        label: localizedText(parameter.label),
        ...(finiteNumber(parameter.max) === undefined ? {} : { max: finiteNumber(parameter.max) }),
        ...(finiteNumber(parameter.min) === undefined ? {} : { min: finiteNumber(parameter.min) }),
        name: parameter.name.trim(),
        options,
        placeholder: localizedText(parameter.placeholder),
        ...(boundedPrecision(parameter.precision) === undefined
          ? {}
          : { precision: boundedPrecision(parameter.precision) }),
        required: parameter.required === true,
        type,
      },
    ]
  })
}

export function websiteDatasourceParameterSchemas(datasource?: Datasource) {
  const schemas = datasource ? datasourceParameterSchemas(datasource) : []
  if (schemas.length) return schemas
  const providerIdentity = [datasource?.identity?.name, datasource?.identity?.provider]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
  const crawlSubpagesName = /jina|watercrawl/.test(providerIdentity)
    ? 'crawl_sub_pages'
    : 'crawl_subpages'
  return LEGACY_WEBSITE_PARAMETER_SCHEMAS.map((schema) =>
    schema.name === 'crawl_subpages' ? { ...schema, name: crawlSubpagesName } : schema,
  )
}

export function datasourceIncludeSubpages(parameters: DatasourceParameters, fallback = true) {
  const value = parameters.crawl_subpages ?? parameters.crawl_sub_pages
  return typeof value === 'boolean' ? value : fallback
}

export function datasourceParameterDefaults(schemas: DatasourceParameterSchema[]) {
  return Object.fromEntries(
    schemas.flatMap((schema) =>
      schema.defaultValue === undefined ? [] : ([[schema.name, schema.defaultValue]] as const),
    ),
  ) satisfies DatasourceParameters
}

export function withDatasourceParameterDefaults(
  schemas: DatasourceParameterSchema[],
  parameters: DatasourceParameters | undefined,
) {
  return {
    ...datasourceParameterDefaults(schemas),
    ...parameters,
  }
}

export function missingRequiredDatasourceParameters(
  schemas: DatasourceParameterSchema[],
  parameters: DatasourceParameters,
) {
  return schemas.filter((schema) => {
    if (!schema.required) return false
    const value = parameters[schema.name]
    if (schema.type === 'unsupported') return true
    return value === undefined || (typeof value === 'string' && !value.trim())
  })
}

export function invalidDatasourceParameters(
  schemas: DatasourceParameterSchema[],
  parameters: DatasourceParameters,
) {
  return schemas.filter((schema) => {
    const value = parameters[schema.name]
    if (value === undefined || value === '') return false
    if (schema.type === 'unsupported') return true
    if (schema.type === 'boolean') return typeof value !== 'boolean'
    if (schema.type === 'number')
      return (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (schema.integer === true && !Number.isInteger(value)) ||
        (schema.precision !== undefined &&
          Math.abs(value - Number(value.toFixed(schema.precision))) >
            Number.EPSILON * Math.max(1, Math.abs(value))) ||
        (schema.min !== undefined && value < schema.min) ||
        (schema.max !== undefined && value > schema.max)
      )
    if (typeof value !== 'string') return true
    if (schema.type === 'select')
      return (
        Boolean(schema.options.length) && !schema.options.some((option) => option.value === value)
      )
    if (schema.name !== 'url') return false
    try {
      const parsed = new URL(value)
      return (
        !['http:', 'https:'].includes(parsed.protocol) ||
        Boolean(parsed.username || parsed.password)
      )
    } catch {
      return true
    }
  })
}

export function datasourceParameterRecord(value: unknown): DatasourceParameters | undefined {
  const candidate = record(value)
  if (!candidate || Object.keys(candidate).length > 50) return undefined
  const entries: Array<[string, DatasourceParameterValue]> = []
  for (const [key, parameter] of Object.entries(candidate)) {
    if (!key || key.length > 255) return undefined
    if (
      typeof parameter !== 'string' &&
      typeof parameter !== 'boolean' &&
      (typeof parameter !== 'number' || !Number.isFinite(parameter))
    )
      return undefined
    entries.push([key, parameter])
  }
  return Object.fromEntries(entries)
}

export function localizedDatasourceText(
  text: Record<string, string | undefined> | undefined,
  language: string,
  fallback: string,
) {
  return (
    text?.[language] ??
    text?.[language.replaceAll('-', '_')] ??
    text?.en_US ??
    text?.zh_Hans ??
    fallback
  )
}
