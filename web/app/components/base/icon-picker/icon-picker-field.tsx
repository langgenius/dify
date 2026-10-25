'use client'

import type { ComponentProps, FocusEvent, RefObject } from 'react'
import type { IconPickerInputValue } from '.'
import { DEFAULT_VALIDITY_STATE } from '@base-ui/react/internals/field-constants'
import { useRegisterFieldControl } from '@base-ui/react/internals/field-register-control'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { useFormContext } from '@base-ui/react/internals/form-context'
import { useLabelableContext, useLabelableId } from '@base-ui/react/internals/labelable-provider'
import { useValueChanged } from '@base-ui/react/internals/useValueChanged'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { useStableCallback } from '@langgenius/dify-ui/use-stable-callback'
import { visuallyHidden, visuallyHiddenInput } from '@langgenius/dify-ui/visually-hidden'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type IconPickerFieldProps = Pick<
  ComponentProps<'input'>,
  'name' | 'disabled' | 'readOnly' | 'required'
>

export function useIconPickerTriggerId(id: string | undefined) {
  return useLabelableId({ id })
}

function serializeIcon(value: IconPickerInputValue | null): string {
  if (!value) return ''
  if (value.type === 'emoji')
    return JSON.stringify({
      type: value.type,
      icon: value.icon,
      background: value.background ?? null,
    })
  if (value.type === 'image')
    return JSON.stringify({ type: value.type, fileId: value.fileId, url: value.url })
  return JSON.stringify({ type: value.type, url: value.url })
}

export function useIconPickerField({
  value,
  onReset,
  triggerRef,
  popupRef,
  ...props
}: IconPickerFieldProps & {
  value: IconPickerInputValue | null
  onReset: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  popupRef: RefObject<HTMLDivElement | null>
}) {
  const field = useFieldRootContext()
  const { clearErrors, elementRef: formElementRef, formRef } = useFormContext()
  const { labelId } = useLabelableContext()
  const triggerId = useLabelableId()
  const inputRef = useRef<HTMLInputElement>(null)
  const disabled = Boolean(field.disabled || props.disabled)
  const name = field.name ?? props.name
  const serializedValue = serializeIcon(value)
  const [resetVersion, setResetVersion] = useState(0)
  const handledResetRef = useRef(0)

  useRegisterFieldControl(triggerRef, triggerId, value, undefined, !disabled, props.name)

  const { registerInput: registerFieldInput } = field.validation
  const registerInput = useCallback(
    (input: HTMLInputElement) =>
      registerFieldInput(input, { controlRef: triggerRef, value: undefined }),
    [registerFieldInput, triggerRef],
  )
  const mergedInputRef = useMergedRefs(inputRef, field.validation.inputRef, registerInput)
  const { setFilled } = field
  useLayoutEffect(() => setFilled(Boolean(serializedValue)), [serializedValue, setFilled])
  useValueChanged(serializedValue, () => {
    clearErrors(name)
    field.setDirty(
      serializedValue !==
        serializeIcon(field.validityData.initialValue as IconPickerInputValue | null),
    )
    field.validation.change(value, resetVersion !== handledResetRef.current)
  })

  const canEdit = useStableCallback(
    () => !disabled && !props.readOnly && !triggerRef.current?.matches(':disabled'),
  )
  const focus = useStableCallback(() => {
    if (disabled || inputRef.current?.matches(':disabled')) return
    field.focusOwnerRef.current = triggerRef
    field.setFocused(true)
  })
  const releaseFocus = useStableCallback(() => {
    if (field.focusOwnerRef.current !== triggerRef) return
    field.focusOwnerRef.current = undefined
    field.setFocused(false)
  })
  const blur = useStableCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.relatedTarget
    if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
    if (field.focusOwnerRef.current !== triggerRef) return
    releaseFocus()
    field.setTouched(true)
    if (field.validationMode === 'onBlur') void field.validation.commit(value)
  })
  useLayoutEffect(() => {
    for (const ref of [triggerRef, popupRef]) {
      const element = ref.current
      const root = element?.getRootNode() as Document | ShadowRoot | undefined
      if (root?.activeElement && element?.contains(root.activeElement)) focus()
    }
    return releaseFocus
  }, [disabled, focus, releaseFocus, triggerRef, popupRef])

  const reset = useStableCallback((event: Event) => {
    if (event.defaultPrevented) return
    onReset()
    setResetVersion((version) => version + 1)
  })
  useEffect(() => {
    const input = inputRef.current
    const form = input?.form ?? formElementRef.current
    if (!form) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const handleReset = (event: Event) => {
      // Delegated React onReset may cancel the native reset after this listener runs.
      timeout = setTimeout(() => reset(event))
    }
    form.addEventListener('reset', handleReset)
    return () => {
      form.removeEventListener('reset', handleReset)
      clearTimeout(timeout)
    }
  }, [formElementRef, reset])
  const resetFeedback = useStableCallback(() => {
    clearErrors(name)
    field.validation.change(undefined, true)
    inputRef.current?.setCustomValidity('')
    field.setTouched(false)
    field.setDirty(
      serializedValue !==
        serializeIcon(field.validityData.initialValue as IconPickerInputValue | null),
    )
    field.setValidityData((previous) => ({
      ...previous,
      state: DEFAULT_VALIDITY_STATE,
      error: '',
      errors: [],
    }))
  })
  useLayoutEffect(() => {
    if (handledResetRef.current === resetVersion) return
    handledResetRef.current = resetVersion
    resetFeedback()
  }, [resetVersion, resetFeedback])

  return {
    triggerId,
    disabled,
    canEdit,
    focus,
    blur,
    triggerProps: {
      'data-required': props.required || undefined,
      'data-readonly': props.readOnly || undefined,
      ...field.validation.getValidationProps(disabled, {
        'aria-labelledby': labelId,
        'aria-disabled': props.readOnly || undefined,
        onFocus: focus,
        onBlur: blur,
      }),
    },
    input: (
      <input
        ref={mergedInputRef}
        type="text"
        name={name}
        value={serializedValue}
        disabled={disabled}
        readOnly={props.readOnly}
        required={props.required}
        autoComplete="off"
        aria-hidden="true"
        tabIndex={-1}
        style={name ? visuallyHiddenInput : visuallyHidden}
        onChange={() => {}}
        onFocus={() => triggerRef.current?.focus()}
        onInvalid={(event) => {
          event.preventDefault()
          field.setTouched(true)
          if (triggerId) formRef.current.fields.get(triggerId)?.validate()
          const firstInvalid = inputRef.current?.form
            ? Array.from(inputRef.current.form.elements).find((element) =>
                element.matches('input:invalid, select:invalid, textarea:invalid'),
              )
            : undefined
          if (!firstInvalid || firstInvalid === inputRef.current) triggerRef.current?.focus()
        }}
      />
    ),
  }
}
