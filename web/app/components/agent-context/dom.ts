'use client'

import type { AgentToolInput, AgentToolResult } from './types'

type AgentActionKind = 'click' | 'fill' | 'focus' | 'press' | 'select' | 'toggle'

type AgentBounds = {
  height: number
  width: number
  x: number
  y: number
}

type AgentElementState = {
  checked?: boolean
  expanded?: boolean
  pressed?: boolean
  required?: boolean
  selected?: boolean
}

export type AgentActionDescriptor = {
  action_id: string
  actions: AgentActionKind[]
  bounds: AgentBounds
  context?: string
  disabled: boolean
  href?: string
  name: string
  placeholder?: string
  role: string
  selector_hint?: string
  stable_id: string
  state?: AgentElementState
  tag: string
  type?: string
  value?: string
}

type DomSnapshotOptions = {
  actionLimit?: number
  textLimit?: number
}

const actionRegistry = new Map<string, Element>()

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[aria-expanded]',
  '[aria-haspopup]',
  '[class*="cursor-pointer"]',
  '[tabindex]:not([tabindex="-1"])',
  'summary',
].join(',')

const DIALOG_SELECTOR = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  'dialog',
].join(',')

const textFrom = (value: unknown) => {
  if (typeof value !== 'string')
    return ''

  return value.replace(/\s+/g, ' ').trim()
}

const compactText = (value: string, limit = 160) => {
  const text = textFrom(value)
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text
}

const toNumber = (value: number) => Math.round(value * 100) / 100

const isElementVisible = (element: Element) => {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement))
    return false

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const getBounds = (element: Element): AgentBounds => {
  const rect = element.getBoundingClientRect()
  return {
    height: toNumber(rect.height),
    width: toNumber(rect.width),
    x: toNumber(rect.x),
    y: toNumber(rect.y),
  }
}

const getInputValue = (element: Element) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    return element.value

  if (element instanceof HTMLElement && element.isContentEditable)
    return textFrom(element.textContent)

  return undefined
}

const getLabelText = (element: Element) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = element.labels?.[0]
    if (label)
      return textFrom(label.textContent)
  }

  const id = element.getAttribute('id')
  if (!id)
    return ''

  const label = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`)
  return label ? textFrom(label.textContent) : ''
}

const getAccessibleName = (element: Element) => {
  const ariaLabel = textFrom(element.getAttribute('aria-label'))
  if (ariaLabel)
    return ariaLabel

  const labelText = getLabelText(element)
  if (labelText)
    return labelText

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => textFrom(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(' ')
    if (text)
      return text
  }

  const placeholder = textFrom(element.getAttribute('placeholder'))
  if (placeholder)
    return placeholder

  const title = textFrom(element.getAttribute('title'))
  if (title)
    return title

  return textFrom(element.textContent)
}

const getRole = (element: Element) => {
  const explicitRole = textFrom(element.getAttribute('role'))
  if (explicitRole)
    return explicitRole

  const tag = element.tagName.toLowerCase()
  if (tag === 'a')
    return 'link'
  if (tag === 'button' || tag === 'summary')
    return 'button'
  if (element instanceof HTMLElement && element.className.includes('cursor-pointer'))
    return 'button'
  if (tag === 'select')
    return 'combobox'
  if (tag === 'textarea')
    return 'textbox'
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase()
    if (type === 'checkbox')
      return 'checkbox'
    if (type === 'radio')
      return 'radio'
    return 'textbox'
  }

  return tag
}

const getActionKinds = (element: Element): AgentActionKind[] => {
  const tag = element.tagName.toLowerCase()
  const role = getRole(element)
  const type = (element.getAttribute('type') || '').toLowerCase()

  if (tag === 'input' && ['checkbox', 'radio'].includes(type))
    return ['toggle', 'click', 'focus']

  if (role === 'checkbox' || role === 'switch' || role === 'radio')
    return ['toggle', 'click', 'focus']

  if (tag === 'input' || tag === 'textarea' || (element instanceof HTMLElement && element.isContentEditable))
    return ['fill', 'focus', 'press']

  if (tag === 'select' || role === 'combobox')
    return ['select', 'click', 'focus']

  return ['click', 'focus']
}

const cssIdentifier = (value: string) => {
  if (typeof CSS !== 'undefined' && CSS.escape)
    return CSS.escape(value)

  return value.replace(/[^\w-]/g, '\\$&')
}

const getSelectorHint = (element: Element) => {
  const testId = element.getAttribute('data-testid')
  if (testId)
    return `[data-testid="${testId.replace(/"/g, '\\"')}"]`

  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel)
    return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`

  const id = element.getAttribute('id')
  if (id)
    return `#${cssIdentifier(id)}`

  const name = element.getAttribute('name')
  if (name)
    return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`

  return undefined
}

const isDisabled = (element: Element) => {
  if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
    return element.disabled

  return element.getAttribute('aria-disabled') === 'true'
}

const hasActionableAncestor = (element: Element, candidateSet: Set<Element>) => {
  let parent = element.parentElement
  while (parent) {
    if (candidateSet.has(parent))
      return true
    parent = parent.parentElement
  }

  return false
}

const isNativeInteractiveElement = (element: Element) => {
  const tag = element.tagName.toLowerCase()
  return ['a', 'button', 'input', 'select', 'summary', 'textarea'].includes(tag)
}

const hashString = (value: string) => {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1)
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)

  return (hash >>> 0).toString(36)
}

const getElementState = (element: Element): AgentElementState | undefined => {
  const state: AgentElementState = {}

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio')
      state.checked = element.checked
    state.required = element.required
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    state.required = element.required

  const expanded = element.getAttribute('aria-expanded')
  if (expanded)
    state.expanded = expanded === 'true'

  const pressed = element.getAttribute('aria-pressed')
  if (pressed)
    state.pressed = pressed === 'true'

  const selected = element.getAttribute('aria-selected')
  if (selected)
    state.selected = selected === 'true'

  return Object.keys(state).length ? state : undefined
}

const getHref = (element: Element) => {
  if (element instanceof HTMLAnchorElement)
    return element.href

  return undefined
}

const getContextText = (element: Element) => {
  const dialog = element.closest(DIALOG_SELECTOR)
  if (dialog)
    return compactText(getAccessibleName(dialog) || dialog.textContent || '', 120)

  const labelledRegion = element.closest('[aria-label], [data-testid], form, main, aside, section')
  if (!labelledRegion)
    return undefined

  const label = labelledRegion.getAttribute('aria-label') || labelledRegion.getAttribute('data-testid') || labelledRegion.tagName.toLowerCase()
  return compactText(label, 120)
}

const getStableActionIdBase = (element: Element) => {
  const parts = [
    element.tagName.toLowerCase(),
    getRole(element),
    getAccessibleName(element),
    getSelectorHint(element) ?? '',
    getHref(element) ?? '',
    element.getAttribute('placeholder') ?? '',
    element.getAttribute('type') ?? '',
    getContextText(element) ?? '',
  ]

  return `dify-action-${hashString(parts.map(part => textFrom(part).toLowerCase()).join('|'))}`
}

export const collectInteractiveElements = (limit = 80): AgentActionDescriptor[] => {
  actionRegistry.clear()

  const candidates = [...document.querySelectorAll(INTERACTIVE_SELECTOR)]
    .filter(isElementVisible)
  const candidateSet = new Set(candidates)
  const occurrenceCounts = new Map<string, number>()

  const elements = candidates
    .filter(element => isNativeInteractiveElement(element) || !hasActionableAncestor(element, candidateSet))
    .slice(0, limit)

  return elements.map((element) => {
    const stableIdBase = getStableActionIdBase(element)
    const nextOccurrence = (occurrenceCounts.get(stableIdBase) ?? 0) + 1
    occurrenceCounts.set(stableIdBase, nextOccurrence)
    const stableId = nextOccurrence === 1 ? stableIdBase : `${stableIdBase}-${nextOccurrence}`
    const actionId = stableId
    actionRegistry.set(actionId, element)
    const placeholder = textFrom(element.getAttribute('placeholder')) || undefined

    return {
      action_id: actionId,
      actions: getActionKinds(element),
      bounds: getBounds(element),
      context: getContextText(element),
      disabled: isDisabled(element),
      href: getHref(element),
      name: compactText(getAccessibleName(element), 180),
      placeholder,
      role: getRole(element),
      selector_hint: getSelectorHint(element),
      stable_id: stableId,
      state: getElementState(element),
      tag: element.tagName.toLowerCase(),
      type: textFrom(element.getAttribute('type')) || undefined,
      value: getInputValue(element),
    }
  })
}

const setNativeValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter)
    prototypeValueSetter.call(element, value)
  else if (valueSetter)
    valueSetter.call(element, value)
  else
    element.value = value
}

const dispatchInputEvents = (element: Element) => {
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

const getStringInput = (input: AgentToolInput | undefined, key: string) => {
  const value = input?.[key]
  return typeof value === 'string' ? value : undefined
}

const getActionElement = (actionId: string) => {
  const element = actionRegistry.get(actionId)
  if (element && document.contains(element) && isElementVisible(element))
    return element

  collectInteractiveElements()
  const refreshedElement = actionRegistry.get(actionId)
  if (refreshedElement && document.contains(refreshedElement) && isElementVisible(refreshedElement))
    return refreshedElement

  return undefined
}

export const performBrowserAction = (input?: AgentToolInput): AgentToolResult => {
  const actionId = getStringInput(input, 'action_id')
  const action = getStringInput(input, 'action') as AgentActionKind | undefined

  if (!actionId || !action)
    throw new Error('Both action_id and action are required.')

  const element = getActionElement(actionId)
  if (!element)
    throw new Error(`No visible element found for action_id "${actionId}". Refresh page context and try again.`)

  if (isDisabled(element))
    throw new Error(`Element "${actionId}" is disabled.`)

  if (action === 'focus') {
    if (element instanceof HTMLElement)
      element.focus()
    return { ok: true, action, action_id: actionId }
  }

  if (action === 'click' || action === 'toggle') {
    if (!(element instanceof HTMLElement))
      throw new Error(`Element "${actionId}" cannot be clicked.`)
    element.click()
    return { ok: true, action, action_id: actionId }
  }

  if (action === 'fill') {
    const value = getStringInput(input, 'value') ?? ''
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, value)
      dispatchInputEvents(element)
      return { ok: true, action, action_id: actionId, value }
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = value
      dispatchInputEvents(element)
      return { ok: true, action, action_id: actionId, value }
    }
    throw new Error(`Element "${actionId}" does not support fill.`)
  }

  if (action === 'select') {
    const value = getStringInput(input, 'value')
    if (!value)
      throw new Error('value is required for select actions.')
    if (!(element instanceof HTMLSelectElement))
      throw new Error(`Element "${actionId}" does not support select.`)
    element.value = value
    dispatchInputEvents(element)
    return { ok: true, action, action_id: actionId, value }
  }

  if (action === 'press') {
    const key = getStringInput(input, 'key')
    if (!key)
      throw new Error('key is required for press actions.')
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }))
    return { ok: true, action, action_id: actionId, key }
  }

  throw new Error(`Unsupported action "${action}".`)
}

const getVisibleTextBlocks = (limit: number) => {
  const selector = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'label',
    '[role="heading"]',
    '[role="status"]',
    '[role="alert"]',
    '[aria-live]',
  ].join(',')

  return [...document.querySelectorAll(selector)]
    .filter(isElementVisible)
    .map(element => textFrom(element.textContent))
    .filter(Boolean)
    .slice(0, limit)
}

const getDialogs = () => {
  return [...document.querySelectorAll(DIALOG_SELECTOR)]
    .filter(isElementVisible)
    .map((element, index) => ({
      id: `dialog-${index + 1}`,
      name: getAccessibleName(element),
      text: textFrom(element.textContent).slice(0, 1000),
    }))
}

export const getDomSnapshot = (options: DomSnapshotOptions = {}) => {
  const {
    actionLimit = 80,
    textLimit = 40,
  } = options

  return {
    actions: collectInteractiveElements(actionLimit),
    dialogs: getDialogs(),
    visible_text: getVisibleTextBlocks(textLimit),
  }
}
