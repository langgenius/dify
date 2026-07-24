import type {
  A2UIBinding,
  A2UIComponent,
  A2UIEnvelope,
  JSONPrimitive,
  JSONValue,
  UIPart,
} from '@/types/a2ui'
import { A2UI_PROTOCOL_VERSION, DIFY_A2UI_CATALOG_ID } from '@/types/a2ui'

const MAX_MESSAGES_PER_PART = 64
const MAX_UI_COMPONENTS = 100
const MAX_JSON_DEPTH = 16
const MAX_JSON_NODES = 2_000
const MAX_JSON_ARRAY_INDEX = 1_000
const MAX_JSON_POINTER_SEGMENTS = 16
const MAX_STRING_LENGTH = 4_096
const MAX_PAYLOAD_BYTES = 128 * 1_024
const MAX_UI_PARTS = 16
const MAX_UI_PARTS_BYTES = 512 * 1_024
const MAX_HISTORY_UI_PART_CANDIDATES = 64
const ID_PATTERN = /^[\dA-Z][\w.:-]{0,127}$/i
const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

type UnknownRecord = Record<string, unknown>

export type UISurface = {
  surfaceId: string
  catalogId: typeof DIFY_A2UI_CATALOG_ID
  components: Map<string, A2UIComponent>
  dataModel: JSONValue
}

export type UISurfaceBuildResult = {
  surfaces: UISurface[]
  error?: string
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  return (
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  )
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isPartId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 512
}

function decodeJSONPointer(value: unknown): string[] | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.length > 256 ||
    value
      .split('/')
      .slice(1)
      .some((segment) => /~(?![01])/.test(segment))
  )
    return undefined

  if (value === '/') return []

  const segments = value
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (segments.length > MAX_JSON_POINTER_SEGMENTS) return undefined
  return segments.some((segment) => UNSAFE_PATH_SEGMENTS.has(segment)) ? undefined : segments
}

function isJSONPointer(value: unknown): value is string {
  return decodeJSONPointer(value) !== undefined
}

function isBinding(value: unknown): value is A2UIBinding {
  return isRecord(value) && hasOnlyKeys(value, ['path']) && isJSONPointer(value.path)
}

function isStringValue(value: unknown): value is string | A2UIBinding {
  return (typeof value === 'string' && value.length <= MAX_STRING_LENGTH) || isBinding(value)
}

function isNumberValue(value: unknown): value is number | A2UIBinding {
  return (typeof value === 'number' && Number.isFinite(value)) || isBinding(value)
}

function isPrimitive(value: unknown): value is JSONPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function isPrimitiveValue(value: unknown): value is JSONPrimitive | A2UIBinding {
  return isPrimitive(value) || isBinding(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_UI_COMPONENTS && value.every(isId)
}

function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}

function isJSONValue(value: unknown): value is JSONValue {
  let nodeCount = 0

  function visit(current: unknown, depth: number): current is JSONValue {
    nodeCount += 1
    if (nodeCount > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false
    if (isPrimitive(current))
      return typeof current !== 'string' || current.length <= MAX_STRING_LENGTH
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index++) {
        if (!visit(current[index], depth + 1)) return false
      }
      return true
    }
    if (!isRecord(current)) return false

    return Object.entries(current).every(
      ([key, item]) => !UNSAFE_PATH_SEGMENTS.has(key) && visit(item, depth + 1),
    )
  }

  return visit(value, 0)
}

function isComponent(value: unknown): value is A2UIComponent {
  if (!isRecord(value) || !isId(value.id) || typeof value.component !== 'string') return false

  switch (value.component) {
    case 'Card':
      return (
        hasOnlyKeys(value, ['id', 'component', 'children'], ['title']) &&
        isStringArray(value.children) &&
        (value.title === undefined || isStringValue(value.title))
      )
    case 'Row':
      return (
        hasOnlyKeys(value, ['id', 'component', 'children'], ['gap', 'align']) &&
        isStringArray(value.children) &&
        (value.gap === undefined || isEnum(value.gap, ['small', 'medium', 'large'] as const)) &&
        (value.align === undefined || isEnum(value.align, ['start', 'center', 'end'] as const))
      )
    case 'Column':
      return (
        hasOnlyKeys(value, ['id', 'component', 'children'], ['gap']) &&
        isStringArray(value.children) &&
        (value.gap === undefined || isEnum(value.gap, ['small', 'medium', 'large'] as const))
      )
    case 'Text':
      return (
        hasOnlyKeys(value, ['id', 'component', 'text'], ['variant']) &&
        isStringValue(value.text) &&
        (value.variant === undefined || isEnum(value.variant, ['body', 'caption'] as const))
      )
    case 'Icon':
      return (
        hasOnlyKeys(value, ['id', 'component', 'name']) &&
        isEnum(value.name, [
          'clock',
          'cloud',
          'sun',
          'rain',
          'snow',
          'wind',
          'thermometer',
          'calendar',
          'location',
        ] as const)
      )
    case 'Divider':
      return hasOnlyKeys(value, ['id', 'component'])
    case 'Badge':
      return (
        hasOnlyKeys(value, ['id', 'component', 'text'], ['tone']) &&
        isStringValue(value.text) &&
        (value.tone === undefined ||
          isEnum(value.tone, ['neutral', 'info', 'success', 'warning', 'critical'] as const))
      )
    case 'Metric':
      return (
        hasOnlyKeys(value, ['id', 'component', 'label', 'value'], ['unit']) &&
        isStringValue(value.label) &&
        isPrimitiveValue(value.value) &&
        (value.unit === undefined || isStringValue(value.unit))
      )
    case 'DateTime':
      return (
        hasOnlyKeys(value, ['id', 'component', 'value'], ['format']) &&
        isStringValue(value.value) &&
        (value.format === undefined || isEnum(value.format, ['date', 'time', 'datetime'] as const))
      )
    case 'Progress':
      return (
        hasOnlyKeys(value, ['id', 'component', 'value', 'label'], ['max']) &&
        isNumberValue(value.value) &&
        (value.max === undefined || isNumberValue(value.max)) &&
        isStringValue(value.label)
      )
    case 'KeyValue':
      return (
        hasOnlyKeys(value, ['id', 'component', 'label', 'value']) &&
        isStringValue(value.label) &&
        isPrimitiveValue(value.value)
      )
    default:
      return false
  }
}

function isCreateSurfaceEnvelope(value: UnknownRecord): value is A2UIEnvelope {
  if (!hasOnlyKeys(value, ['version', 'createSurface'])) return false
  if (!isRecord(value.createSurface)) return false

  return (
    hasOnlyKeys(value.createSurface, ['surfaceId', 'catalogId']) &&
    isId(value.createSurface.surfaceId) &&
    value.createSurface.catalogId === DIFY_A2UI_CATALOG_ID
  )
}

function isUpdateComponentsEnvelope(value: UnknownRecord): value is A2UIEnvelope {
  if (!hasOnlyKeys(value, ['version', 'updateComponents'])) return false
  if (!isRecord(value.updateComponents)) return false

  const components = value.updateComponents.components
  if (
    !hasOnlyKeys(value.updateComponents, ['surfaceId', 'components']) ||
    !isId(value.updateComponents.surfaceId) ||
    !Array.isArray(components) ||
    components.length === 0 ||
    components.length > MAX_UI_COMPONENTS
  )
    return false

  const componentIds = new Set<string>()
  return components.every((component) => {
    if (!isComponent(component) || componentIds.has(component.id)) return false
    componentIds.add(component.id)
    return true
  })
}

function isUpdateDataModelEnvelope(value: UnknownRecord): value is A2UIEnvelope {
  if (!hasOnlyKeys(value, ['version', 'updateDataModel'])) return false
  if (!isRecord(value.updateDataModel)) return false

  return (
    hasOnlyKeys(value.updateDataModel, ['surfaceId', 'value'], ['path']) &&
    isId(value.updateDataModel.surfaceId) &&
    (value.updateDataModel.path === undefined || isJSONPointer(value.updateDataModel.path)) &&
    isJSONValue(value.updateDataModel.value)
  )
}

function isDeleteSurfaceEnvelope(value: UnknownRecord): value is A2UIEnvelope {
  if (!hasOnlyKeys(value, ['version', 'deleteSurface'])) return false
  if (!isRecord(value.deleteSurface)) return false

  return hasOnlyKeys(value.deleteSurface, ['surfaceId']) && isId(value.deleteSurface.surfaceId)
}

function isEnvelope(value: unknown): value is A2UIEnvelope {
  if (!isRecord(value) || value.version !== A2UI_PROTOCOL_VERSION) return false

  return (
    isCreateSurfaceEnvelope(value) ||
    isUpdateComponentsEnvelope(value) ||
    isUpdateDataModelEnvelope(value) ||
    isDeleteSurfaceEnvelope(value)
  )
}

function getEnvelopeSurfaceId(message: A2UIEnvelope) {
  if ('createSurface' in message) return message.createSurface.surfaceId
  if ('updateComponents' in message) return message.updateComponents.surfaceId
  if ('updateDataModel' in message) return message.updateDataModel.surfaceId
  return message.deleteSurface.surfaceId
}

function hasValidMessageLifecycle(messages: A2UIEnvelope[]) {
  const firstMessage = messages[0]
  if (!firstMessage || !('createSurface' in firstMessage)) return false

  const surfaceId = firstMessage.createSurface.surfaceId
  let deleteSeen = false
  for (const [index, message] of messages.entries()) {
    if (getEnvelopeSurfaceId(message) !== surfaceId) return false
    if (index > 0 && 'createSurface' in message) return false
    if ('deleteSurface' in message) {
      if (deleteSeen || index !== messages.length - 1) return false
      deleteSeen = true
    }
  }
  return true
}

function getUIPartPayloadByteLength(value: UnknownRecord) {
  try {
    return new TextEncoder().encode(
      JSON.stringify({
        protocol: value.protocol,
        protocol_version: value.protocol_version,
        messages: value.messages,
        fallback: value.fallback,
      }),
    ).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function parseUIPartEnvelope(value: unknown): UIPart | undefined {
  if (!isRecord(value)) return undefined
  if (
    !hasOnlyKeys(
      value,
      ['part_id', 'sequence', 'protocol', 'protocol_version', 'messages'],
      ['fallback'],
    )
  )
    return undefined

  if (
    !isPartId(value.part_id) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    value.protocol !== 'a2ui' ||
    value.protocol_version !== A2UI_PROTOCOL_VERSION ||
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    value.messages.length > MAX_MESSAGES_PER_PART ||
    !value.messages.every(isEnvelope) ||
    (value.fallback !== undefined &&
      value.fallback !== null &&
      (typeof value.fallback !== 'string' || value.fallback.length > MAX_STRING_LENGTH)) ||
    getUIPartPayloadByteLength(value) > MAX_PAYLOAD_BYTES
  )
    return undefined

  return value as UIPart
}

export function parseUIPart(value: unknown): UIPart | undefined {
  const part = parseUIPartEnvelope(value)
  if (!part) return undefined
  if (!hasValidMessageLifecycle(part.messages)) return undefined

  return buildUISurfaces(part.messages).error ? undefined : part
}

type UIPartUpsertResult = {
  parts: UIPart[]
  resourceLimitExceeded: boolean
}

function getUIPartsByteLength(parts: UIPart[]) {
  try {
    return new TextEncoder().encode(JSON.stringify(parts)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function upsertParsedUIPart(current: UIPart[], part: UIPart): UIPartUpsertResult {
  if (current.length > MAX_UI_PARTS || getUIPartsByteLength(current) > MAX_UI_PARTS_BYTES)
    return { parts: current, resourceLimitExceeded: true }

  const existingIndex = current.findIndex((item) => item.part_id === part.part_id)
  if (existingIndex === -1 && current.length >= MAX_UI_PARTS)
    return { parts: current, resourceLimitExceeded: true }
  if (existingIndex > -1 && current[existingIndex]!.sequence >= part.sequence)
    return { parts: current, resourceLimitExceeded: false }

  const next = [...current]
  if (existingIndex === -1) next.push(part)
  else next[existingIndex] = part

  return getUIPartsByteLength(next) > MAX_UI_PARTS_BYTES
    ? { parts: current, resourceLimitExceeded: true }
    : { parts: next, resourceLimitExceeded: false }
}

export function upsertUIPart(current: UIPart[], incoming: unknown): UIPart[] {
  const part = parseUIPart(incoming)
  if (!part) return current

  return upsertParsedUIPart(current, part).parts
}

function normalizeUIPartsWithStatus(value: unknown): UIPartUpsertResult {
  if (!Array.isArray(value)) return { parts: [], resourceLimitExceeded: false }
  if (value.length > MAX_HISTORY_UI_PART_CANDIDATES)
    return { parts: [], resourceLimitExceeded: true }

  let parts: UIPart[] = []
  for (const item of value) {
    const part = parseUIPart(item)
    if (!part) continue

    const result = upsertParsedUIPart(parts, part)
    if (result.resourceLimitExceeded) return { parts: [], resourceLimitExceeded: true }
    parts = result.parts
  }
  return { parts, resourceLimitExceeded: false }
}

export function normalizeUIParts(value: unknown): UIPart[] {
  return normalizeUIPartsWithStatus(value).parts
}

export function reconcileHistoryUIParts(
  current: UIPart[] | undefined,
  historyValue: unknown,
): UIPart[] | undefined {
  if (historyValue === undefined) return current

  const normalized = normalizeUIPartsWithStatus(historyValue)
  return normalized.resourceLimitExceeded ? current : normalized.parts
}

export function buildUISurfaces(messages: A2UIEnvelope[]): UISurfaceBuildResult {
  if (!messages.every(isEnvelope)) return { surfaces: [], error: 'invalid_messages' }

  const surfaces = new Map<string, UISurface>()

  for (const message of messages) {
    if ('createSurface' in message) {
      const { surfaceId, catalogId } = message.createSurface
      surfaces.set(surfaceId, {
        surfaceId,
        catalogId,
        components: new Map(),
        dataModel: {},
      })
      continue
    }

    if ('updateComponents' in message) {
      const surface = surfaces.get(message.updateComponents.surfaceId)
      if (!surface) continue
      for (const component of message.updateComponents.components) {
        surface.components.set(component.id, component)
        if (surface.components.size > MAX_UI_COMPONENTS)
          return { surfaces: [], error: 'too_many_components' }
      }
      continue
    }

    if ('updateDataModel' in message) {
      const surface = surfaces.get(message.updateDataModel.surfaceId)
      if (surface) {
        const updatedModel = updateJSONPointer(
          surface.dataModel,
          message.updateDataModel.path ?? '/',
          message.updateDataModel.value,
        )
        if (updatedModel === undefined || !isJSONValue(updatedModel))
          return { surfaces: [], error: 'invalid_data_model_update' }
        surface.dataModel = updatedModel
      }
      continue
    }

    surfaces.delete(message.deleteSurface.surfaceId)
  }

  const builtSurfaces = [...surfaces.values()]
  for (const surface of builtSurfaces) {
    const graphError = getSurfaceGraphError(surface)
    if (graphError) return { surfaces: [], error: graphError }
  }

  return { surfaces: builtSurfaces }
}

export function getSurfaceGraphError(surface: UISurface): string | undefined {
  if (surface.components.size > MAX_UI_COMPONENTS) return 'too_many_components'
  if (!surface.components.has('root')) return 'missing_root'

  const parents = new Map<string, string>()
  for (const component of surface.components.values()) {
    if (
      component.component !== 'Card' &&
      component.component !== 'Row' &&
      component.component !== 'Column'
    )
      continue

    const ownChildren = new Set<string>()
    for (const childId of component.children) {
      if (ownChildren.has(childId)) return 'duplicate_child'
      ownChildren.add(childId)
      if (childId === 'root') return 'root_as_child'
      if (!surface.components.has(childId)) return 'missing_component'
      if (parents.has(childId)) return 'multiple_parents'
      parents.set(childId, component.id)
    }
  }

  const visited = new Set<string>()
  const pending = ['root']
  while (pending.length) {
    const componentId = pending.pop()!
    if (visited.has(componentId)) return 'component_cycle'
    const component = surface.components.get(componentId)
    if (!component) return 'missing_component'

    visited.add(componentId)
    if (visited.size > MAX_UI_COMPONENTS) return 'render_budget_exceeded'
    if (
      component.component === 'Card' ||
      component.component === 'Row' ||
      component.component === 'Column'
    )
      pending.push(...component.children)
  }

  return visited.size === surface.components.size ? undefined : 'unreachable_component'
}

export function resolveJSONPointer(model: JSONValue, pointer: string): JSONValue | undefined {
  const segments = decodeJSONPointer(pointer)
  if (!segments) return undefined
  if (!segments.length) return model

  let current: JSONValue | undefined = model

  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return undefined
      current = current[Number(segment)]
      continue
    }
    if (isRecord(current)) {
      const next = current[segment]
      current = isJSONValue(next) ? next : undefined
      continue
    }
    return undefined
  }

  return current
}

function updateJSONPointer(
  model: JSONValue,
  pointer: string,
  value: JSONValue,
): JSONValue | undefined {
  const segments = decodeJSONPointer(pointer)
  if (!segments) return undefined
  if (!segments.length) return value
  const pointerSegments = segments

  function update(current: JSONValue | undefined, segmentIndex: number): JSONValue | undefined {
    if (segmentIndex === pointerSegments.length) return value

    const segment = pointerSegments[segmentIndex]!
    const isArraySegment = /^(?:0|[1-9]\d*)$/.test(segment)
    if (Array.isArray(current) || (!isRecord(current) && isArraySegment)) {
      if (!isArraySegment) return undefined
      const index = Number(segment)
      if (index > MAX_JSON_ARRAY_INDEX) return undefined

      const next = Array.isArray(current) ? [...current] : []
      if (index > next.length) return undefined
      const updatedChild = update(next[index], segmentIndex + 1)
      if (updatedChild === undefined) return undefined
      next[index] = updatedChild
      return next
    }

    const next: Record<string, JSONValue> = isRecord(current)
      ? { ...(current as Record<string, JSONValue>) }
      : {}
    const updatedChild = update(next[segment], segmentIndex + 1)
    if (updatedChild === undefined) return undefined
    next[segment] = updatedChild
    return next
  }

  return update(model, 0)
}
