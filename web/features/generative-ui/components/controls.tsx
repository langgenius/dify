'use client'

import type { ComponentRenderProps } from '@openuidev/react-lang'
import type { z } from 'zod/v4'
import type {
  ActionButtonDefinition,
  FormDefinition,
  SelectFieldDefinition,
  TextFieldDefinition,
} from '../registry/definitions'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
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
import {
  FormNameContext,
  useFormName,
  useGetFieldValue,
  useSetDefaultValue,
  useStateField,
  useTriggerAction,
} from '@openuidev/react-lang'
import { memo, use, useCallback, useId, useLayoutEffect, useRef } from 'react'
import { InteractionsDisabledContext } from './interaction-context'

export function ActionButton({
  props,
}: ComponentRenderProps<z.infer<typeof ActionButtonDefinition.props>>) {
  const disabled = use(InteractionsDisabledContext)
  const triggerAction = useTriggerAction()
  return (
    <Button disabled={disabled} onClick={() => triggerAction(props.message)}>
      {props.label}
    </Button>
  )
}

function useTextField(name: string, initialValue: string) {
  // oxlint-disable-next-line eslint-react/use-state -- OpenUI returns a StateField object, not a React state tuple.
  const { value, setValue } = useStateField(name, initialValue)
  const setValueRef = useRef(setValue)
  useLayoutEffect(() => {
    setValueRef.current = setValue
  }, [setValue])
  // OpenUI recreates its setter on every store update. Keep the control's callback stable
  // while still following changes to the field's form, name, or binding.
  const handleValueChange = useCallback((nextValue: string) => setValueRef.current(nextValue), [])
  const formName = useFormName()
  const getFieldValue = useGetFieldValue()
  useSetDefaultValue({
    formName,
    name,
    existingValue: getFieldValue(formName, name),
    defaultValue: initialValue,
  })
  return { value, setValue: handleValueChange }
}

type ControlledFieldProps = {
  value: string
  onValueChange: (value: string) => void
  disabled: boolean
}

// The connectors keep reading OpenUI state; only unchanged controls can skip rendering.
const TextFieldControl = memo(
  ({
    name,
    label,
    required,
    value,
    onValueChange,
    disabled,
  }: Omit<z.infer<typeof TextFieldDefinition.props>, 'initialValue'> & ControlledFieldProps) => {
    return (
      <Field name={name} disabled={disabled}>
        <FieldLabel>{label}</FieldLabel>
        <Input value={value} onValueChange={onValueChange} required={required} />
        <FieldError />
      </Field>
    )
  },
)

const SelectFieldControl = memo(
  ({
    name,
    label,
    required,
    options,
    value,
    onValueChange,
    disabled,
  }: Omit<z.infer<typeof SelectFieldDefinition.props>, 'initialValue'> & ControlledFieldProps) => {
    return (
      <Field name={name} disabled={disabled}>
        <Select<string>
          items={options.map((option) => ({ label: option, value: option }))}
          value={value || null}
          onValueChange={(nextValue) => onValueChange(nextValue ?? '')}
          required={required}
          disabled={disabled}
        >
          <SelectLabel>{label}</SelectLabel>
          <SelectTrigger>
            <SelectValue<string> />
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
        <FieldError />
      </Field>
    )
  },
)

export function TextField({
  props,
}: ComponentRenderProps<z.infer<typeof TextFieldDefinition.props>>) {
  const disabled = use(InteractionsDisabledContext)
  const field = useTextField(props.name, props.initialValue)
  return (
    <TextFieldControl
      name={props.name}
      label={props.label}
      required={props.required}
      value={field.value}
      onValueChange={field.setValue}
      disabled={disabled}
    />
  )
}

export function SelectField({
  props,
}: ComponentRenderProps<z.infer<typeof SelectFieldDefinition.props>>) {
  const disabled = use(InteractionsDisabledContext)
  const field = useTextField(props.name, props.initialValue)
  return (
    <SelectFieldControl
      name={props.name}
      label={props.label}
      required={props.required}
      options={props.options}
      value={field.value}
      onValueChange={field.setValue}
      disabled={disabled}
    />
  )
}

export function GeneratedForm({
  props,
  renderNode,
}: ComponentRenderProps<z.infer<typeof FormDefinition.props>>) {
  const disabled = use(InteractionsDisabledContext)
  const triggerAction = useTriggerAction()
  const titleId = useId()
  return (
    <FormNameContext value={props.name}>
      <Form
        aria-labelledby={titleId}
        onFormSubmit={() => {
          if (!disabled) void triggerAction(props.message, props.name)
        }}
        className="flex min-w-0 flex-col gap-3"
      >
        <h3 id={titleId} className="system-md-semibold text-text-primary">
          {props.title}
        </h3>
        {renderNode(props.fields)}
        <div>
          <Button type="submit" disabled={disabled}>
            {props.submitLabel}
          </Button>
        </div>
      </Form>
    </FormNameContext>
  )
}
