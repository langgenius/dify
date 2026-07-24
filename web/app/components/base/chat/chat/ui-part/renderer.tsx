import type { ReactNode } from 'react'
import type {
  A2UIBinding,
  A2UIComponent,
  A2UIDynamic,
  JSONPrimitive,
  JSONValue,
  UIPart,
} from '@/types/a2ui'
import {
  buildUISurfaces,
  getSurfaceGraphError,
  parseUIPartEnvelope,
  resolveJSONPointer,
} from './state'

const ICON_CLASSES: Record<string, string> = {
  calendar: 'i-ri-calendar-line',
  clock: 'i-ri-time-line',
  cloud: 'i-ri-cloudy-2-line',
  location: 'i-ri-map-pin-2-line',
  rain: 'i-ri-rainy-line',
  snow: 'i-ri-snowy-line',
  sun: 'i-ri-sun-line',
  thermometer: 'i-ri-temp-hot-line',
  wind: 'i-ri-windy-line',
}

const GAP_CLASSES = {
  small: 'gap-1',
  medium: 'gap-2',
  large: 'gap-4',
} as const

const ALIGN_CLASSES = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
} as const

const BADGE_CLASSES = {
  neutral: 'bg-background-section text-text-secondary',
  info: 'bg-state-info-hover text-state-info-solid',
  success: 'bg-state-success-hover text-state-success-solid',
  warning: 'bg-state-warning-hover text-state-warning-solid',
  critical: 'bg-state-destructive-hover text-state-destructive-solid',
} as const

const MAX_RENDERED_COMPONENTS = 100

function isBinding(value: JSONPrimitive | A2UIBinding): value is A2UIBinding {
  return typeof value === 'object' && value !== null && 'path' in value
}

function resolveDynamic<T extends JSONPrimitive>(
  value: A2UIDynamic<T>,
  model: JSONValue,
): JSONValue | undefined {
  return isBinding(value) ? resolveJSONPointer(model, value.path) : value
}

function resolveString(
  value: A2UIDynamic<string> | undefined,
  model: JSONValue,
): string | undefined {
  if (value === undefined) return undefined
  const resolved = resolveDynamic(value, model)
  return typeof resolved === 'string' ? resolved : undefined
}

function resolveNumber(
  value: A2UIDynamic<number> | undefined,
  model: JSONValue,
): number | undefined {
  if (value === undefined) return undefined
  const resolved = resolveDynamic(value, model)
  return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : undefined
}

function displayPrimitive(value: JSONValue | undefined) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value === null ? '' : String(value)

  return undefined
}

function formatDateTime(value: string, format: 'date' | 'time' | 'datetime') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const formatOptions: Intl.DateTimeFormatOptions =
    format === 'date'
      ? { dateStyle: 'medium' }
      : format === 'time'
        ? { timeStyle: 'short' }
        : { dateStyle: 'medium', timeStyle: 'short' }

  return new Intl.DateTimeFormat(undefined, formatOptions).format(date)
}

function renderChildren(
  component: Extract<A2UIComponent, { component: 'Card' | 'Row' | 'Column' }>,
  renderComponent: (componentId: string) => ReactNode,
) {
  return component.children.map((childId) => (
    <div key={childId} className="min-w-0">
      {renderComponent(childId)}
    </div>
  ))
}

function Surface({ surface }: { surface: ReturnType<typeof buildUISurfaces>['surfaces'][number] }) {
  const graphError = getSurfaceGraphError(surface)
  if (graphError) return null
  const renderedComponentIds = new Set<string>()
  let renderFailed = false

  function renderComponent(componentId: string): ReactNode {
    if (
      renderFailed ||
      renderedComponentIds.has(componentId) ||
      renderedComponentIds.size >= MAX_RENDERED_COMPONENTS
    ) {
      renderFailed = true
      return null
    }
    renderedComponentIds.add(componentId)

    const component = surface.components.get(componentId)
    if (!component) {
      renderFailed = true
      return null
    }
    const model = surface.dataModel

    switch (component.component) {
      case 'Card': {
        const title = resolveString(component.title, model)
        return (
          <section className="w-full rounded-xl border border-components-panel-border bg-background-default-subtle p-4 shadow-xs">
            {title && <h3 className="mb-3 title-sm-semi-bold text-text-primary">{title}</h3>}
            <div className="flex flex-col gap-3">{renderChildren(component, renderComponent)}</div>
          </section>
        )
      }
      case 'Row':
        return (
          <div
            className={`flex flex-wrap ${GAP_CLASSES[component.gap ?? 'medium']} ${ALIGN_CLASSES[component.align ?? 'center']}`}
          >
            {renderChildren(component, renderComponent)}
          </div>
        )
      case 'Column':
        return (
          <div className={`flex flex-col ${GAP_CLASSES[component.gap ?? 'medium']}`}>
            {renderChildren(component, renderComponent)}
          </div>
        )
      case 'Text': {
        const text = resolveString(component.text, model)
        if (text === undefined) return null
        if (component.variant === 'caption')
          return <p className="body-xs-regular text-text-tertiary">{text}</p>
        return <p className="body-md-regular whitespace-pre-wrap text-text-secondary">{text}</p>
      }
      case 'Icon': {
        const iconClass = ICON_CLASSES[component.name]
        return iconClass ? (
          <span className={`${iconClass} size-5 text-text-secondary`} aria-hidden="true" />
        ) : null
      }
      case 'Divider':
        return <hr className="border-divider-subtle" />
      case 'Badge': {
        const text = resolveString(component.text, model)
        if (text === undefined) return null
        return (
          <span
            className={`inline-flex w-fit rounded-md px-2 py-1 body-xs-medium ${BADGE_CLASSES[component.tone ?? 'neutral']}`}
          >
            {text}
          </span>
        )
      }
      case 'Metric': {
        const label = resolveString(component.label, model)
        const value = displayPrimitive(resolveDynamic(component.value, model))
        const unit = resolveString(component.unit, model)
        if (label === undefined || value === undefined) return null
        return (
          <dl>
            <dt className="body-xs-medium text-text-tertiary">{label}</dt>
            <dd className="mt-0.5 flex items-baseline gap-1">
              <span className="title-xl-semi-bold text-text-primary">{value}</span>
              {unit && <span className="body-sm-medium text-text-secondary">{unit}</span>}
            </dd>
          </dl>
        )
      }
      case 'DateTime': {
        const value = resolveString(component.value, model)
        if (value === undefined) return null
        return (
          <time dateTime={value} className="body-md-medium text-text-primary">
            {formatDateTime(value, component.format ?? 'datetime')}
          </time>
        )
      }
      case 'Progress': {
        const value = resolveNumber(component.value, model)
        const max = resolveNumber(component.max, model) ?? 100
        const label = resolveString(component.label, model)
        if (value === undefined || label === undefined || max <= 0) return null
        const normalizedValue = Math.min(Math.max(value, 0), max)
        const percentage = (normalizedValue / max) * 100
        return (
          <div className="w-full">
            <div className="mb-1 body-xs-medium text-text-secondary">{label}</div>
            <div
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={normalizedValue}
              className="h-2 overflow-hidden rounded-full bg-background-section"
            >
              <div
                className="h-full rounded-full bg-components-progress-brand-progress"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )
      }
      case 'KeyValue': {
        const label = resolveString(component.label, model)
        const value = displayPrimitive(resolveDynamic(component.value, model))
        if (label === undefined || value === undefined) return null
        return (
          <dl className="flex items-baseline justify-between gap-4">
            <dt className="body-sm-regular text-text-secondary">{label}</dt>
            <dd className="text-right body-sm-medium text-text-primary">{value}</dd>
          </dl>
        )
      }
    }
  }

  const content = renderComponent('root')
  return renderFailed ? null : <div data-surface-id={surface.surfaceId}>{content}</div>
}

function Part({ part }: { part: UIPart }) {
  const validPart = parseUIPartEnvelope(part)
  if (!validPart) return null

  const result = buildUISurfaces(validPart.messages)
  const hasInvalidGraph = result.surfaces.some((surface) => getSurfaceGraphError(surface))
  if (result.error || hasInvalidGraph) {
    return validPart.fallback ? (
      <p className="body-sm-regular text-text-tertiary">{validPart.fallback}</p>
    ) : null
  }

  if (!result.surfaces.length) return null

  return (
    <div className="flex w-full flex-col gap-3" data-ui-part-id={validPart.part_id}>
      {result.surfaces.map((surface) => (
        <Surface key={surface.surfaceId} surface={surface} />
      ))}
    </div>
  )
}

export function UIPartList({ parts }: { parts: UIPart[] }) {
  if (!parts.length) return null

  return (
    <div className="my-2 flex w-full flex-col gap-3">
      {parts.map((part) => (
        <Part key={part.part_id} part={part} />
      ))}
    </div>
  )
}
