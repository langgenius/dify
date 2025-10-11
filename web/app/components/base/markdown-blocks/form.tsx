import React, { useEffect, useState } from 'react'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import Checkbox from '@/app/components/base/checkbox'
import Select from '@/app/components/base/select'
import { useChatContext } from '@/app/components/base/chat/chat/context'
import { formatDateForOutput } from '@/app/components/base/date-and-time-picker/utils/dayjs'

enum DATA_FORMAT {
  TEXT = 'text',
  JSON = 'json',
}
enum SUPPORTED_TAGS {
  LABEL = 'label',
  INPUT = 'input',
  TEXTAREA = 'textarea',
  BUTTON = 'button',
}
enum SUPPORTED_TYPES {
  TEXT = 'text',
  PASSWORD = 'password',
  EMAIL = 'email',
  NUMBER = 'number',
  DATE = 'date',
  TIME = 'time',
  DATETIME = 'datetime',
  CHECKBOX = 'checkbox',
  SELECT = 'select',
  HIDDEN = 'hidden',
}
const MarkdownForm = ({ node }: any) => {
  const { onSend } = useChatContext()

  const [formValues, setFormValues] = useState<{ [key: string]: any }>({})

  useEffect(() => {
    const initialValues: { [key: string]: any } = {}
    node.children.forEach((child: any) => {
      if ([SUPPORTED_TAGS.INPUT, SUPPORTED_TAGS.TEXTAREA].includes(child.tagName)) {
        initialValues[child.properties.name]
          = (child.tagName === SUPPORTED_TAGS.INPUT && child.properties.type === SUPPORTED_TYPES.HIDDEN)
            ? (child.properties.value || '')
            : child.properties.value
      }
    })
    setFormValues(initialValues)
  }, [node.children])

  const getFormValues = (children: any) => {
    const values: { [key: string]: any } = {}
    children.forEach((child: any) => {
      if ([SUPPORTED_TAGS.INPUT, SUPPORTED_TAGS.TEXTAREA].includes(child.tagName)) {
        let value = formValues[child.properties.name]

        if (child.tagName === SUPPORTED_TAGS.INPUT
            && (child.properties.type === SUPPORTED_TYPES.DATE || child.properties.type === SUPPORTED_TYPES.DATETIME)) {
          if (value && typeof value.format === 'function') {
            // Format date output consistently
            const includeTime = child.properties.type === SUPPORTED_TYPES.DATETIME
            value = formatDateForOutput(value, includeTime)
          }
        }

        values[child.properties.name] = value
      }
    })
    return values
  }

  const onSubmit = (e: any) => {
    e.preventDefault()
    const format = node.properties.dataFormat || DATA_FORMAT.TEXT
    const result = getFormValues(node.children)

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
  return (
    <form
      autoComplete="off"
      className='flex flex-col self-stretch'
      onSubmit={(e: any) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {node.children.filter((i: any) => i.type === 'element').map((child: any, index: number) => {
        if (child.tagName === SUPPORTED_TAGS.LABEL) {
          return (
            <label
              key={index}
              htmlFor={child.properties.for}
              className="system-md-semibold my-2 text-text-secondary"
            >
              {child.children[0]?.value || ''}
            </label>
          )
        }
        if (child.tagName === SUPPORTED_TAGS.INPUT && Object.values(SUPPORTED_TYPES).includes(child.properties.type)) {
          if (child.properties.type === SUPPORTED_TYPES.DATE || child.properties.type === SUPPORTED_TYPES.DATETIME) {
            return (
              <DatePicker
                key={index}
                value={formValues[child.properties.name]}
                needTimePicker={child.properties.type === SUPPORTED_TYPES.DATETIME}
                onChange={(date) => {
                  setFormValues(prevValues => ({
                    ...prevValues,
                    [child.properties.name]: date,
                  }))
                }}
                onClear={() => {
                  setFormValues(prevValues => ({
                    ...prevValues,
                    [child.properties.name]: undefined,
                  }))
                }}
              />
            )
          }
          if (child.properties.type === SUPPORTED_TYPES.TIME) {
            return (
              <TimePicker
                key={index}
                value={formValues[child.properties.name]}
                onChange={(time) => {
                  setFormValues(prevValues => ({
                    ...prevValues,
                    [child.properties.name]: time,
                  }))
                }}
                onClear={() => {
                  setFormValues(prevValues => ({
                    ...prevValues,
                    [child.properties.name]: undefined,
                  }))
                }}
              />
            )
          }
          if (child.properties.type === SUPPORTED_TYPES.CHECKBOX) {
            return (
              <div className='mt-2 flex h-6 items-center space-x-2' key={index}>
                <Checkbox
                  key={index}
                  checked={formValues[child.properties.name]}
                  onCheck={() => {
                    setFormValues(prevValues => ({
                      ...prevValues,
                      [child.properties.name]: !prevValues[child.properties.name],
                    }))
                  }}
                />
                <span>{child.properties.dataTip || child.properties['data-tip'] || ''}</span>
              </div>
            )
          }
          if (child.properties.type === SUPPORTED_TYPES.SELECT) {
            return (
              <Select
                key={index}
                allowSearch={false}
                className="w-full"
                items={(() => {
                  let options = child.properties.dataOptions || child.properties['data-options'] || []
                  if (typeof options === 'string') {
                    try {
                      options = JSON.parse(options)
                    }
                    catch (e) {
                      console.error('Failed to parse options:', e)
                      options = []
                    }
                  }
                  return options.map((option: string) => ({
                    name: option,
                    value: option,
                  }))
                })()}
                defaultValue={formValues[child.properties.name]}
                onSelect={(item) => {
                  setFormValues(prevValues => ({
                    ...prevValues,
                    [child.properties.name]: item.value,
                  }))
                }}
              />
            )
          }

          if (child.properties.type === SUPPORTED_TYPES.HIDDEN) {
            return (
              <input
                key={index}
                type="hidden"
                name={child.properties.name}
                value={formValues[child.properties.name] || child.properties.value || ''}
              />
            )
          }

          return (
            <Input
              key={index}
              type={child.properties.type}
              name={child.properties.name}
              placeholder={child.properties.placeholder}
              value={formValues[child.properties.name]}
              onChange={(e) => {
                setFormValues(prevValues => ({
                  ...prevValues,
                  [child.properties.name]: e.target.value,
                }))
              }}
            />
          )
        }
        if (child.tagName === SUPPORTED_TAGS.TEXTAREA) {
          return (
            <Textarea
              key={index}
              name={child.properties.name}
              placeholder={child.properties.placeholder}
              value={formValues[child.properties.name]}
              onChange={(e) => {
                setFormValues(prevValues => ({
                  ...prevValues,
                  [child.properties.name]: e.target.value,
                }))
              }}
            />
          )
        }
        if (child.tagName === SUPPORTED_TAGS.BUTTON) {
          const variant = child.properties.dataVariant
          const size = child.properties.dataSize

          return (
            <Button
              variant={variant}
              size={size}
              className='mt-4'
              key={index}
              onClick={onSubmit}
            >
              <span className='text-[13px]'>{child.children[0]?.value || ''}</span>
            </Button>
          )
        }

        return <p key={index}>Unsupported tag: {child.tagName}</p>
      })}
    </form>
  )
}
MarkdownForm.displayName = 'MarkdownForm'
export default MarkdownForm
