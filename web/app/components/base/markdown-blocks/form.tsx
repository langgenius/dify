import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { Dayjs } from 'dayjs'
import { Button } from '@langgenius/dify-ui/button'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import Checkbox from '@/app/components/base/checkbox'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import { formatDateForOutput, toDayjs } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'

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

type SupportedType = typeof SUPPORTED_TYPES[keyof typeof SUPPORTED_TYPES]

const SUPPORTED_TYPES_SET = new Set<string>(Object.values(SUPPORTED_TYPES))

const SAFE_NAME_RE = /^[a-z][\w-]*$/i
const PROTOTYPE_POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 128
    && SAFE_NAME_RE.test(name)
    && !PROTOTYPE_POISON_KEYS.has(name)
}

const VALID_BUTTON_VARIANTS = new Set<string>([
  'primary',
  'warning',
  'secondary',
  'secondary-accent',
  'ghost',
  'ghost-accent',
  'tertiary',
])
const VALID_BUTTON_SIZES = new Set<string>(['small', 'medium', 'large'])

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

function str(val: unknown): string {
  if (val == null)
    return ''
  return String(val)
}

function computeInitialFormValues(children: HastElement[]): FormValues {
  const init: FormValues = Object.create(null) as FormValues
  for (const child of children) {
    if (child.tagName !== SUPPORTED_TAGS.INPUT && child.tagName !== SUPPORTED_TAGS.TEXTAREA)
      continue
    const name = child.properties.name
    if (!isSafeName(name))
      continue

    const type = child.tagName === SUPPORTED_TAGS.INPUT ? str(child.properties.type) : ''

    if (type === SUPPORTED_TYPES.HIDDEN) {
      init[name] = str(child.properties.value)
    }
    else if (type === SUPPORTED_TYPES.DATE || type === SUPPORTED_TYPES.DATETIME || type === SUPPORTED_TYPES.TIME) {
      const raw = child.properties.value
      init[name] = raw != null ? toDayjs(String(raw)) : undefined
    }
    else if (type === SUPPORTED_TYPES.CHECKBOX) {
      const { checked, value } = child.properties
      init[name] = !!checked || value === true || value === 'true'
    }
    else {
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

  if (tag === SUPPORTED_TAGS.LABEL)
    return `label-${index}-${htmlFor || name}`
  if (tag === SUPPORTED_TAGS.INPUT)
    return `input-${index}-${type}-${name}`
  if (tag === SUPPORTED_TAGS.TEXTAREA)
    return `textarea-${index}-${name}`
  if (tag === SUPPORTED_TAGS.BUTTON)
    return `button-${index}-${getTextContent(child)}`
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

  const baseFormValues = useMemo(
    () => computeInitialFormValues(elementChildren),
    [elementChildren],
  )

  const [editState, setEditState] = useState<EditState>(() => ({
    source: elementChildren,
    edits: {},
  }))

  const formValues = useMemo<FormValues>(() => {
    if (editState.source === elementChildren)
      return { ...baseFormValues, ...editState.edits }
    return baseFormValues
  }, [editState, baseFormValues, elementChildren])

  const updateValue = useCallback((name: string, value: FormValue) => {
    if (!isSafeName(name))
      return
    setEditState(prev => ({
      source: elementChildren,
      edits: {
        ...(prev.source === elementChildren ? prev.edits : {}),
        [name]: value,
      },
    }))
  }, [elementChildren])

  const getFormOutput = useCallback((): Record<string, string | boolean | undefined> => {
    const out = Object.create(null) as Record<string, string | boolean | undefined>
    for (const child of elementChildren) {
      if (child.tagName !== SUPPORTED_TAGS.INPUT && child.tagName !== SUPPORTED_TAGS.TEXTAREA)
        continue
      const name = child.properties.name
      if (!isSafeName(name))
        continue
      let value: FormValue = formValues[name]
      if (
        child.tagName === SUPPORTED_TAGS.INPUT
        && (child.properties.type === SUPPORTED_TYPES.DATE || child.properties.type === SUPPORTED_TYPES.DATETIME)
        && value != null
        && typeof value === 'object'
        && 'format' in value
      ) {
        const includeTime = child.properties.type === SUPPORTED_TYPES.DATETIME
        value = formatDateForOutput(value as Dayjs, includeTime)
      }
      if (typeof value === 'boolean')
        out[name] = value
      else
        out[name] = value != null ? String(value) : undefined
    }
    return out
  }, [elementChildren, formValues])

  const onSubmit = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (isSubmitting)
      return
    setIsSubmitting(true)
    try {
      const format = str(typedNode.properties.dataFormat) || DATA_FORMAT.TEXT
      const result = getFormOutput()
      if (format === DATA_FORMAT.JSON) {
        onSend?.(JSON.stringify(result))
      }
      else {
        const textResult = Object.entries(result)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
        onSend?.(textResult)
      }
    }
    catch {
      setIsSubmitting(false)
    }
  }, [isSubmitting, typedNode.properties.dataFormat, getFormOutput, onSend])

  return (
    <form
      autoComplete="off"
      className="flex flex-col self-stretch"
      data-testid="markdown-form"
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
              htmlFor={str(child.properties.htmlFor || child.properties.name)}
              className="my-2 system-md-semibold text-text-secondary"
              data-testid="label-field"
            >
              {getTextContent(child)}
            </label>
          )
        }

        if (child.tagName === SUPPORTED_TAGS.INPUT && SUPPORTED_TYPES_SET.has(str(child.properties.type))) {
          const name = str(child.properties.name)
          if (!isSafeName(name))
            return null

          const type = str(child.properties.type) as SupportedType

          if (type === SUPPORTED_TYPES.DATE || type === SUPPORTED_TYPES.DATETIME) {
            return (
              <DatePicker
                key={key}
                value={formValues[name] as Dayjs | undefined}
                needTimePicker={type === SUPPORTED_TYPES.DATETIME}
                onChange={date => updateValue(name, date)}
                onClear={() => updateValue(name, undefined)}
              />
            )
          }
          if (type === SUPPORTED_TYPES.TIME) {
            return (
              <TimePicker
                key={key}
                value={formValues[name] as Dayjs | string | undefined}
                onChange={time => updateValue(name, time)}
                onClear={() => updateValue(name, undefined)}
              />
            )
          }
          if (type === SUPPORTED_TYPES.CHECKBOX) {
            return (
              <div className="mt-2 flex h-6 items-center space-x-2" key={key}>
                <Checkbox
                  checked={!!formValues[name]}
                  onCheck={() => updateValue(name, !formValues[name])}
                  id={name}
                />
                <span>{str(child.properties.dataTip || child.properties['data-tip'])}</span>
              </div>
            )
          }
          if (type === SUPPORTED_TYPES.SELECT) {
            const rawOptions = child.properties.dataOptions || child.properties['data-options'] || []
            let options: string[] = []
            if (typeof rawOptions === 'string') {
              try {
                const parsed: unknown = JSON.parse(rawOptions)
                if (Array.isArray(parsed))
                  options = parsed.filter((o): o is string => typeof o === 'string')
              }
              catch (error) {
                console.error('Failed to parse data-options JSON:', rawOptions, error)
                options = []
              }
            }
            else if (Array.isArray(rawOptions)) {
              options = rawOptions.filter((o): o is string => typeof o === 'string')
            }
            return (
              <Select
                key={key}
                defaultValue={formValues[name] as string | undefined}
                onValueChange={(val) => {
                  if (val != null)
                    updateValue(name, val)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map(option => (
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
              onChange={e => updateValue(name, e.target.value)}
            />
          )
        }

        if (child.tagName === SUPPORTED_TAGS.TEXTAREA) {
          const name = str(child.properties.name)
          if (!isSafeName(name))
            return null
          return (
            <Textarea
              key={key}
              name={name}
              placeholder={str(child.properties.placeholder)}
              value={str(formValues[name])}
              onChange={e => updateValue(name, e.target.value)}
            />
          )
        }

        if (child.tagName === SUPPORTED_TAGS.BUTTON) {
          const rawVariant = str(child.properties.dataVariant)
          const rawSize = str(child.properties.dataSize)
          const variant = VALID_BUTTON_VARIANTS.has(rawVariant)
            ? rawVariant as ButtonProps['variant']
            : undefined
          const size = VALID_BUTTON_SIZES.has(rawSize)
            ? rawSize as ButtonProps['size']
            : undefined

          return (
            <Button
              variant={variant}
              size={size}
              className="mt-4"
              key={key}
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
