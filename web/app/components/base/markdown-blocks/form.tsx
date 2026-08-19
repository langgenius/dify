import type { Dayjs } from 'dayjs'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import {
  formatDateForOutput,
  toDayjs,
} from '@/app/components/base/date-and-time-picker/utils/dayjs'
import Input from '@/app/components/base/input'
import { MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS } from '@/config'
import { getMarkdownButtonAppearance } from './button-appearance'

const DATA_FORMAT = {
  TEXT: 'text',
  JSON: 'json',
} as const

const SUPPORTED_TAGS = {
  LABEL: 'label',
  INPUT: 'input',
  TEXTAREA: 'textarea',
  BUTTON: 'button',
} as const

const SUPPORTED_TYPES = {
  TEXT: 'text',
  PASSWORD: 'password',
  EMAIL: 'email',
  NUMBER: 'number',
  DATE: 'date',
  TIME: 'time',
  DATETIME: 'datetime',
  CHECKBOX: 'checkbox',
  SELECT: 'select',
  HIDDEN: 'hidden',
} as const

type SupportedType = (typeof SUPPORTED_TYPES)[keyof typeof SUPPORTED_TYPES]

const SUPPORTED_TYPES_SET = new Set<string>(Object.values(SUPPORTED_TYPES))

const SAFE_NAME_RE = (() => {
  try {
    return new RegExp('^\\p{L}[\\p{L}\\p{M}\\p{N}_-]*$', 'u')
  } catch {
    // Fallback for browsers without Unicode property escape support.
    return /^[a-z][\w-]*$/i
  }
})()
// Treat operator-provided characters literally instead of interpolating them into a regular expression.
const EXTRA_SAFE_NAME_CHARS = new Set(MARKDOWN_FORM_FIELD_NAME_EXTRA_CHARS)
const PROTOTYPE_POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false

  const [firstChar, ...remainingChars] = Array.from(name)
  return (
    firstChar !== undefined &&
    SAFE_NAME_RE.test(firstChar) &&
    remainingChars.every(
      (char) => SAFE_NAME_RE.test(`A${char}`) || EXTRA_SAFE_NAME_CHARS.has(char),
    ) &&
    !PROTOTYPE_POISON_KEYS.has(name)
  )
}

type HastText = {
  type: 'text'
  value: string
}

type HastElement = {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: Array<HastElement | HastText>
}

type FormValue = string | boolean | Dayjs | undefined
type FormValues = Record<string, FormValue>
type EditState = {
  source: HastElement[]
  edits: FormValues
}

function getTextContent(node: HastElement): string {
  const textChild = node.children.find((c): c is HastText => c.type === 'text')
  return textChild?.value ?? ''
}

function getLabelTarget(node: HastElement): string {
  return str(node.properties.htmlFor || node.properties.for || node.properties.name)
}

function str(val: unknown): string {
  if (val == null) return ''
  return String(val)
}

function computeInitialFormValues(children: HastElement[]): FormValues {
  const init: FormValues = Object.create(null) as FormValues
  for (const child of children) {
    if (child.tagName !== SUPPORTED_TAGS.INPUT && child.tagName !== SUPPORTED_TAGS.TEXTAREA)
      continue
    const name = child.properties.name
    if (!isSafeName(name)) continue

    const type = child.tagName === SUPPORTED_TAGS.INPUT ? str(child.properties.type) : ''

    if (type === SUPPORTED_TYPES.HIDDEN) {
      init[name] = str(child.properties.value)
    } else if (
      type === SUPPORTED_TYPES.DATE ||
      type === SUPPORTED_TYPES.DATETIME ||
      type === SUPPORTED_TYPES.TIME
    ) {
      const raw = child.properties.value
      init[name] = raw != null ? toDayjs(String(raw)) : undefined
    } else if (type === SUPPORTED_TYPES.CHECKBOX) {
      const { checked, value } = child.properties
      const hasInitialValue = checked != null || value != null
      init[name] = hasInitialValue ? !!checked || value === true || value === 'true' : undefined
    } else {
      init[name] = child.properties.value != null ? str(child.properties.value) : undefined
    }
  }
  return init
}

function getElementKey(child: HastElement, index: number): string {
  const tag = child.tagName
  const name = str(child.properties.name)
  const htmlFor = str(child.properties.htmlFor)
  const type = str(child.properties.type)

  if (tag === SUPPORTED_TAGS.LABEL) return `label-${index}-${htmlFor || name}`
  if (tag === SUPPORTED_TAGS.INPUT) return `input-${index}-${type}-${name}`
  if (tag === SUPPORTED_TAGS.TEXTAREA) return `textarea-${index}-${name}`
  if (tag === SUPPORTED_TAGS.BUTTON) return `button-${index}-${getTextContent(child)}`
  return `${tag}-${index}`
}

const MarkdownForm = ({ node }: { node: HastElement }) => {
  const typedNode = node
  const { onSend } = useChatContext()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const elementChildren = useMemo(
    () => typedNode.children.filter((c): c is HastElement => c.type === 'element'),
    [typedNode.children],
  )

  const baseFormValues = useMemo(() => computeInitialFormValues(elementChildren), [elementChildren])

  const [editState, setEditState] = useState<EditState>(() => ({
    source: elementChildren,
    edits: {},
  }))

  const formValues = useMemo<FormValues>(() => {
    if (editState.source === elementChildren) return { ...baseFormValues, ...editState.edits }
    return baseFormValues
  }, [editState, baseFormValues, elementChildren])

  const updateValue = useCallback(
    (name: string, value: FormValue) => {
      if (!isSafeName(name)) return
      setEditState((prev) => ({
        source: elementChildren,
        edits: {
          ...(prev.source === elementChildren ? prev.edits : {}),
          [name]: value,
        },
      }))
    },
    [elementChildren],
  )

  const getFormOutput = useCallback((): Record<string, string | boolean | undefined> => {
    const out = Object.create(null) as Record<string, string | boolean | undefined>
    for (const child of elementChildren) {
      if (child.tagName !== SUPPORTED_TAGS.INPUT && child.tagName !== SUPPORTED_TAGS.TEXTAREA)
        continue
      const name = child.properties.name
      if (!isSafeName(name)) continue
      let value: FormValue = formValues[name]
      if (
        child.tagName === SUPPORTED_TAGS.INPUT &&
        (child.properties.type === SUPPORTED_TYPES.DATE ||
          child.properties.type === SUPPORTED_TYPES.DATETIME) &&
        value != null &&
        typeof value === 'object' &&
        'format' in value
      ) {
        const includeTime = child.properties.type === SUPPORTED_TYPES.DATETIME
        value = formatDateForOutput(value as Dayjs, includeTime)
      }
      if (value === undefined) continue
      if (typeof value === 'boolean') out[name] = value
      else out[name] = String(value)
    }
    return out
  }, [elementChildren, formValues])

  const onSubmit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        const format = str(typedNode.properties.dataFormat) || DATA_FORMAT.TEXT
        const result = getFormOutput()
        if (format === DATA_FORMAT.JSON) {
          onSend?.(JSON.stringify(result))
        } else {
          const textResult = Object.entries(result)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
          onSend?.(textResult)
        }
      } catch {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, typedNode.properties.dataFormat, getFormOutput, onSend],
  )

  return (
    <form
      autoComplete="off"
      className="flex flex-col self-stretch"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {elementChildren.map((child, index) => {
        const key = getElementKey(child, index)
        if (child.tagName === SUPPORTED_TAGS.LABEL) {
          return (
            <label
              key={key}
              htmlFor={getLabelTarget(child)}
              className="my-2 system-md-semibold text-text-secondary"
            >
              {getTextContent(child)}
            </label>
          )
        }

        if (
          child.tagName === SUPPORTED_TAGS.INPUT &&
          SUPPORTED_TYPES_SET.has(str(child.properties.type))
        ) {
          const name = str(child.properties.name)
          if (!isSafeName(name)) return null

          const type = str(child.properties.type) as SupportedType

          if (type === SUPPORTED_TYPES.DATE || type === SUPPORTED_TYPES.DATETIME) {
            return (
              <DatePicker
                key={key}
                value={formValues[name] as Dayjs | undefined}
                needTimePicker={type === SUPPORTED_TYPES.DATETIME}
                onChange={(date) => updateValue(name, date)}
                onClear={() => updateValue(name, undefined)}
              />
            )
          }
          if (type === SUPPORTED_TYPES.TIME) {
            return (
              <TimePicker
                key={key}
                value={formValues[name] as Dayjs | string | undefined}
                onChange={(time) => updateValue(name, time)}
                onClear={() => updateValue(name, undefined)}
              />
            )
          }
          if (type === SUPPORTED_TYPES.CHECKBOX) {
            const label = str(child.properties.dataTip || child.properties['data-tip'])
            const hasExternalLabel = elementChildren.some(
              (node) => node.tagName === SUPPORTED_TAGS.LABEL && getLabelTarget(node) === name,
            )
            const checkboxAriaLabel = label || (hasExternalLabel ? undefined : name)
            return (
              <div className="mt-2 flex h-6 items-center space-x-2" key={key}>
                <Checkbox
                  id={name}
                  checked={!!formValues[name]}
                  aria-label={checkboxAriaLabel}
                  onCheckedChange={(checked) => updateValue(name, checked)}
                />
                {label && <span>{label}</span>}
              </div>
            )
          }
          if (type === SUPPORTED_TYPES.SELECT) {
            const rawOptions =
              child.properties.dataOptions || child.properties['data-options'] || []
            let options: string[] = []
            if (typeof rawOptions === 'string') {
              try {
                const parsed: unknown = JSON.parse(rawOptions)
                if (Array.isArray(parsed))
                  options = parsed.filter((o): o is string => typeof o === 'string')
              } catch (error) {
                console.error('Failed to parse data-options JSON:', rawOptions, error)
                options = []
              }
            } else if (Array.isArray(rawOptions)) {
              options = rawOptions.filter((o): o is string => typeof o === 'string')
            }
            return (
              <Select
                key={key}
                defaultValue={formValues[name] as string | undefined}
                onValueChange={(val) => {
                  if (val != null) updateValue(name, val)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option} value={option}>
                      <SelectItemText>{option}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          }

          if (type === SUPPORTED_TYPES.HIDDEN) {
            return (
              <input
                key={key}
                type="hidden"
                name={name}
                value={str(formValues[name] ?? child.properties.value)}
              />
            )
          }

          return (
            <Input
              key={key}
              type={type}
              name={name}
              placeholder={str(child.properties.placeholder)}
              value={str(formValues[name])}
              onChange={(e) => updateValue(name, e.target.value)}
            />
          )
        }

        if (child.tagName === SUPPORTED_TAGS.TEXTAREA) {
          const name = str(child.properties.name)
          if (!isSafeName(name)) return null
          return (
            <Textarea
              aria-label={name}
              key={key}
              name={name}
              placeholder={str(child.properties.placeholder)}
              value={str(formValues[name])}
              onValueChange={(value) => updateValue(name, value)}
            />
          )
        }

        if (child.tagName === SUPPORTED_TAGS.BUTTON) {
          const appearance = getMarkdownButtonAppearance(
            child.properties.dataVariant,
            child.properties.dataSize,
          )

          return (
            <Button
              key={key}
              {...appearance}
              className="mt-4"
              disabled={isSubmitting}
              onClick={onSubmit}
            >
              <span className="text-[13px]">{getTextContent(child)}</span>
            </Button>
          )
        }

        return (
          <p key={key}>
            Unsupported tag:
            {child.tagName}
          </p>
        )
      })}
    </form>
  )
}
MarkdownForm.displayName = 'MarkdownForm'
export default MarkdownForm
