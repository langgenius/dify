export const A2UI_PROTOCOL_VERSION = 'v0.9.1' as const
export const DIFY_A2UI_CATALOG_ID = 'https://dify.ai/a2ui/catalog/v1' as const

export type JSONPrimitive = string | number | boolean | null
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue }

export type A2UIBinding = {
  path: string
}

export type A2UIDynamic<T extends JSONPrimitive> = T | A2UIBinding

type A2UIComponentBase = {
  id: string
}

export type A2UICard = A2UIComponentBase & {
  component: 'Card'
  children: string[]
  title?: A2UIDynamic<string>
}

export type A2UIRow = A2UIComponentBase & {
  component: 'Row'
  children: string[]
  gap?: 'small' | 'medium' | 'large'
  align?: 'start' | 'center' | 'end'
}

export type A2UIColumn = A2UIComponentBase & {
  component: 'Column'
  children: string[]
  gap?: 'small' | 'medium' | 'large'
}

export type A2UIText = A2UIComponentBase & {
  component: 'Text'
  text: A2UIDynamic<string>
  variant?: 'body' | 'caption'
}

export type A2UIIcon = A2UIComponentBase & {
  component: 'Icon'
  name:
    | 'clock'
    | 'cloud'
    | 'sun'
    | 'rain'
    | 'snow'
    | 'wind'
    | 'thermometer'
    | 'calendar'
    | 'location'
}

export type A2UIDivider = A2UIComponentBase & {
  component: 'Divider'
}

export type A2UIBadge = A2UIComponentBase & {
  component: 'Badge'
  text: A2UIDynamic<string>
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'critical'
}

export type A2UIMetric = A2UIComponentBase & {
  component: 'Metric'
  label: A2UIDynamic<string>
  value: A2UIDynamic<JSONPrimitive>
  unit?: A2UIDynamic<string>
}

export type A2UIDateTime = A2UIComponentBase & {
  component: 'DateTime'
  value: A2UIDynamic<string>
  format?: 'date' | 'time' | 'datetime'
}

export type A2UIProgress = A2UIComponentBase & {
  component: 'Progress'
  value: A2UIDynamic<number>
  max?: A2UIDynamic<number>
  label: A2UIDynamic<string>
}

export type A2UIKeyValue = A2UIComponentBase & {
  component: 'KeyValue'
  label: A2UIDynamic<string>
  value: A2UIDynamic<JSONPrimitive>
}

export type A2UIComponent =
  | A2UICard
  | A2UIRow
  | A2UIColumn
  | A2UIText
  | A2UIIcon
  | A2UIDivider
  | A2UIBadge
  | A2UIMetric
  | A2UIDateTime
  | A2UIProgress
  | A2UIKeyValue

type A2UIEnvelopeBase = {
  version: typeof A2UI_PROTOCOL_VERSION
}

export type A2UICreateSurfaceEnvelope = A2UIEnvelopeBase & {
  createSurface: {
    surfaceId: string
    catalogId: typeof DIFY_A2UI_CATALOG_ID
  }
}

export type A2UIUpdateComponentsEnvelope = A2UIEnvelopeBase & {
  updateComponents: {
    surfaceId: string
    components: A2UIComponent[]
  }
}

export type A2UIUpdateDataModelEnvelope = A2UIEnvelopeBase & {
  updateDataModel: {
    surfaceId: string
    path?: string
    value: JSONValue
  }
}

export type A2UIDeleteSurfaceEnvelope = A2UIEnvelopeBase & {
  deleteSurface: {
    surfaceId: string
  }
}

export type A2UIEnvelope =
  | A2UICreateSurfaceEnvelope
  | A2UIUpdateComponentsEnvelope
  | A2UIUpdateDataModelEnvelope
  | A2UIDeleteSurfaceEnvelope

export type UIPart = {
  part_id: string
  sequence: number
  protocol: 'a2ui'
  protocol_version: typeof A2UI_PROTOCOL_VERSION
  messages: A2UIEnvelope[]
  fallback?: string | null
}

export type UIPartStreamEvent = {
  event: 'ui_part'
  id: string
  part: UIPart
}
