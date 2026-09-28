import type { ConversationItem, FormField } from '../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { FILE_FIELD_TYPES, toFileEntities } from './form-values'

type ResponseField = NonNullable<
  Extract<ConversationItem, { kind: 'interaction_response' }>['payload']['fields']
>[number]

const MULTILINE_TYPES = new Set(['textarea', 'paragraph', 'json', 'json_object'])

export const ReadOnlyFormResponse = ({
  fields,
  sourceFields,
}: {
  fields: ResponseField[]
  sourceFields?: FormField[]
}) => {
  const sourceFieldsByKey = new Map(sourceFields?.map((field) => [field.key, field]) ?? [])

  return (
    <div className="flex flex-col gap-3 px-2 pb-2">
      {fields.map((field) => {
        const sourceField = sourceFieldsByKey.get(field.key)
        const type = sourceField?.type
        const isBoolean = type === 'bool' || type === 'checkbox' || typeof field.value === 'boolean'
        if (isBoolean) {
          return (
            <Field key={field.key} name={field.key}>
              <FieldLabel className="flex items-center gap-2">
                <Checkbox checked={field.value === true} disabled />
                <span>{field.label}</span>
              </FieldLabel>
            </Field>
          )
        }

        if (type === 'select') {
          return (
            <Field key={field.key} name={field.key}>
              <Select<string>
                value={typeof field.value === 'string' && field.value ? field.value : null}
                readOnly
              >
                <SelectLabel>{field.label}</SelectLabel>
                <SelectTrigger>
                  <SelectValue>{() => field.display_value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(sourceField?.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      <SelectItemText>{option}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )
        }

        if (type && FILE_FIELD_TYPES.has(type)) {
          const files = toFileEntities(field.value)
          return (
            <fieldset key={field.key} className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-1 system-xs-medium text-text-secondary">{field.label}</legend>
              <ul className="flex min-h-8 flex-col gap-1 rounded-lg bg-components-input-bg-normal px-3 py-1.75 system-sm-regular text-components-input-text-filled">
                {files.length > 0 ? (
                  files.map((file) => (
                    <li key={file.id} className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="i-ri-attachment-2 size-4 shrink-0" />
                      <span className="min-w-0 wrap-break-word">{file.name}</span>
                    </li>
                  ))
                ) : (
                  <li>{field.display_value}</li>
                )}
              </ul>
            </fieldset>
          )
        }

        const isMultiline =
          (type !== undefined && MULTILINE_TYPES.has(type)) ||
          (typeof field.value === 'string' && field.value.includes('\n')) ||
          (typeof field.value === 'object' && field.value !== null)
        const isNumber = type === 'number' && typeof field.value === 'number'
        const value = isNumber ? String(field.value) : field.display_value

        return (
          <Field key={field.key} name={field.key}>
            <FieldLabel>{field.label}</FieldLabel>
            {isMultiline ? (
              <Textarea
                value={value}
                readOnly
                className="min-h-18 resize-none"
                onValueChange={() => undefined}
              />
            ) : (
              <Input type={isNumber ? 'number' : 'text'} value={value} readOnly />
            )}
          </Field>
        )
      })}
    </div>
  )
}
