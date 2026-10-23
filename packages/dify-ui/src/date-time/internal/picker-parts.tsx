'use client'

import type { Field } from '@base-ui/react/field'
import type { BaseUIComponentProps } from '@base-ui/react/internals/types'
import type { TextDirection } from '../../direction-provider'
import type { IconButtonProps } from '../../icon-button'
import type {
  PopoverActions,
  PopoverChangeEventDetails,
  PopoverContentProps,
  PopoverProps,
  PopoverTriggerProps,
} from '../../popover'
import type { PickerChangeEventDetails } from './use-picker-value'
import { createChangeEventDetails } from '@base-ui/react/internals/createBaseUIEventDetails'
import {
  DEFAULT_VALIDITY_STATE,
  fieldValidityMapping,
} from '@base-ui/react/internals/field-constants'
import { useRegisterFieldControl } from '@base-ui/react/internals/field-register-control'
import { useFieldRootContext } from '@base-ui/react/internals/field-root-context'
import { useFormContext } from '@base-ui/react/internals/form-context'
import { getStateAttributesProps } from '@base-ui/react/internals/getStateAttributesProps'
import {
  useLabel,
  useLabelableContext,
  useLabelableId,
} from '@base-ui/react/internals/labelable-provider'
import { useRenderElement } from '@base-ui/react/internals/useRenderElement'
import { useValueChanged } from '@base-ui/react/internals/useValueChanged'
import { ownerDocument, ownerWindow } from '@base-ui/utils/owner'
import { activeElement, contains, getTarget } from '@base-ui/utils/shadowDom'
import { useStableCallback } from '@base-ui/utils/useStableCallback'
import { useTimeout } from '@base-ui/utils/useTimeout'
import { visuallyHidden, visuallyHiddenInput } from '@base-ui/utils/visuallyHidden'
import * as React from 'react'
import { cn } from '../../cn'
import { DirectionProvider, useDirection } from '../../direction-provider'
import { IconButton } from '../../icon-button'
import { formLabelClassName } from '../../internal/form-control'
import { resolveClassName } from '../../internal/resolve-class-name'
import { mergeProps } from '../../merge-props'
import { Popover, PopoverContent, PopoverTrigger } from '../../popover'
import { useMergedRefs } from '../../use-merged-refs'
import { arePickerValuesEqual } from './use-picker-value'

type PickerOpenChangeDetails = Omit<PopoverChangeEventDetails, 'preventUnmountOnClose'>

type PickerFieldProps = Pick<PopoverProps, 'open' | 'defaultOpen'> & {
  /** Overrides DirectionProvider for this field and its popup; independent of locale. */
  direction?: TextDirection
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  requiredLabel?: string
  invalid?: boolean
  name?: string
  form?: string
  validationMessage?: string
  onOpenChange?: (open: boolean, details: PickerOpenChangeDetails) => void
  children: React.ReactNode
}

type PickerContextValue = Omit<PickerFieldProps, 'children'> & {
  displayValue: string
  serializedValue: string
  triggerId: string | undefined
  valueId: string
  labelId: string | undefined
  setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>
  errorId: string
  requiredId: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  clear: (event: React.MouseEvent<HTMLButtonElement>) => void
  canEdit: () => boolean
  focus: (element: HTMLElement) => void
  releaseFocus: (element?: HTMLElement) => void
  blur: (nextTarget: Element | null) => void
  popupRef: React.RefObject<HTMLDivElement | null>
  clearRef: React.RefObject<HTMLButtonElement | null>
  close: () => void
}

const PickerContext = React.createContext<PickerContextValue | null>(null)

function usePickerContext() {
  const context = React.useContext(PickerContext)
  if (!context) throw new Error('Picker parts must be inside their picker root.')
  return context
}

function usePickerFocusRef<ElementType extends HTMLElement>(
  elementRef: React.RefObject<ElementType | null>,
  disabled = false,
) {
  const { focus, releaseFocus } = usePickerContext()
  React.useLayoutEffect(() => {
    if (disabled && elementRef.current) releaseFocus(elementRef.current)
  }, [disabled, elementRef, releaseFocus])
  return React.useCallback(
    (element: ElementType) => {
      if (contains(element, activeElement(ownerDocument(element)))) focus(element)
      return () => releaseFocus(element)
    },
    [focus, releaseFocus],
  )
}

function PickerRoot({
  value,
  displayValue,
  serializedValue,
  onClear,
  onReset,
  children,
  ...props
}: PickerFieldProps & {
  value: string | Date | null
  displayValue: string
  serializedValue: string
  onClear: (details: PickerChangeEventDetails) => boolean
  onReset: (details: PickerChangeEventDetails) => boolean
}) {
  const inheritedDirection = useDirection()
  const direction = props.direction ?? inheritedDirection
  const field = useFieldRootContext()
  const { clearErrors, elementRef: formElementRef, formRef } = useFormContext()
  const { labelId: fieldLabelId } = useLabelableContext()
  const triggerId = useLabelableId()
  const id = React.useId()
  const [labelId, setLabelId] = React.useState<string>()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const clearRef = React.useRef<HTMLButtonElement>(null)
  const popupRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const focusedPartRef = React.useRef<HTMLElement | null>(null)
  const actionsRef = React.useRef<PopoverActions>(null)
  const disabled = Boolean(field.disabled || props.disabled)
  const name = field.name ?? props.name
  const [eligible, setEligible] = React.useState(false)
  const [validationAttempted, setValidationAttempted] = React.useState(false)
  const [resetVersion, setResetVersion] = React.useState(0)
  const handledResetVersionRef = React.useRef(0)
  const errorMessage = props.invalid
    ? (props.validationMessage ?? 'Choose a valid value.')
    : validationAttempted && props.required && !serializedValue
      ? (props.validationMessage ?? 'Choose a value.')
      : undefined
  const invalid = Boolean(errorMessage || field.state.valid === false)
  const canEdit = useStableCallback(
    () => !disabled && !props.readOnly && !inputRef.current?.matches(':disabled'),
  )
  const formValue = useStableCallback(() => serializedValue)
  useRegisterFieldControl(triggerRef, triggerId, value, formValue, eligible, props.name)

  // Registration follows the proxy input's native form owner, including disabled fieldsets.
  React.useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    function updateEligibility() {
      const form = formElementRef.current
      setEligible(
        Boolean(
          input &&
          !input.matches(':disabled') &&
          (!form || input.form === form || (!input.form && !input.hasAttribute('form'))),
        ),
      )
    }
    updateEligibility()
    const observer = new (ownerWindow(input).MutationObserver)(updateEligibility)
    for (let ancestor: Element | null = input; ancestor; ancestor = ancestor.parentElement)
      observer.observe(ancestor, { attributes: true, attributeFilter: ['disabled', 'form'] })
    return () => observer.disconnect()
  }, [disabled, props.form, formElementRef])
  const { registerInput: registerFieldInput } = field.validation
  const { setFilled } = field
  const registerInput = React.useCallback(
    (input: HTMLInputElement) =>
      registerFieldInput(input, { controlRef: triggerRef, value: undefined }),
    [registerFieldInput],
  )
  const mergedInputRef = useMergedRefs(inputRef, field.validation.inputRef, registerInput)

  const customValidationMessage = props.invalid
    ? (props.validationMessage ?? 'Choose a valid value.').replace(/\r\n?/g, '\n')
    : ''
  React.useLayoutEffect(() => {
    inputRef.current?.setCustomValidity(customValidationMessage)
  }, [customValidationMessage])
  useValueChanged(customValidationMessage, () => {
    // Replace the native constraint before Field clears its cached custom error, so it cannot
    // restore an obsolete picker message. Previously validated fields need a fresh verdict.
    if (resetVersion !== handledResetVersionRef.current) return
    if (field.validityData.state.valid !== null || field.shouldValidateOnChange()) {
      field.validation.commit(value)
      // Barred inputs hide validationMessage, so Field restores its displaced message regardless
      // of ownership. Retire that stale constraint after its synchronous cleanup as well.
      const input = inputRef.current
      if (input && !input.willValidate) input.setCustomValidity(customValidationMessage)
    } else field.validation.change(undefined, true)
  })
  React.useLayoutEffect(() => {
    setFilled(Boolean(serializedValue))
  }, [setFilled, serializedValue])
  useValueChanged(serializedValue, () => {
    clearErrors(name)
    field.setDirty(!arePickerValuesEqual(value, field.validityData.initialValue))
    field.validation.change(value, resetVersion !== handledResetVersionRef.current)
  })

  const focus = useStableCallback((element: HTMLElement) => {
    if (disabled || element.matches(':disabled')) return
    focusedPartRef.current = element
    field.focusOwnerRef.current = triggerRef
    field.setFocused(true)
  })
  const releaseFocus = useStableCallback((element?: HTMLElement) => {
    if (element && focusedPartRef.current !== element) return
    if (field.focusOwnerRef.current !== triggerRef) return
    focusedPartRef.current = null
    field.focusOwnerRef.current = undefined
    field.setFocused(false)
  })
  const blur = useStableCallback((nextTarget: Element | null) => {
    if (
      contains(triggerRef.current, nextTarget) ||
      contains(clearRef.current, nextTarget) ||
      contains(popupRef.current, nextTarget)
    )
      return
    if (field.focusOwnerRef.current !== triggerRef) return
    releaseFocus()
    field.setTouched(true)
    if (field.validationMode === 'onBlur') field.validation.commit(value)
  })
  React.useLayoutEffect(() => {
    if (disabled || !eligible) releaseFocus()
    return releaseFocus
  }, [disabled, eligible, releaseFocus])

  const resetTimeout = useTimeout()
  const resetPicker = useStableCallback((event: Event) => {
    if (event.defaultPrevented) return
    const details = createChangeEventDetails('reset', event)
    if (!onReset(details)) return
    setValidationAttempted(false)
    setResetVersion((version) => version + 1)
  })
  const resetFieldFeedback = useStableCallback(() => {
    clearErrors(name)
    field.validation.change(undefined, true)
    field.setTouched(false)
    field.setDirty(!arePickerValuesEqual(value, field.validityData.initialValue))
    inputRef.current?.setCustomValidity(customValidationMessage)
    field.setValidityData((previous) => ({
      ...previous,
      state: DEFAULT_VALIDITY_STATE,
      error: '',
      errors: [],
    }))
    actionsRef.current?.close()
  })
  React.useLayoutEffect(() => {
    if (resetVersion === handledResetVersionRef.current) return
    handledResetVersionRef.current = resetVersion
    resetFieldFeedback()
  }, [resetVersion, resetFieldFeedback])
  React.useEffect(() => {
    const input = inputRef.current
    const form = input?.form ?? (!input?.hasAttribute('form') ? formElementRef.current : null)
    if (!form) return
    function reset(event: Event) {
      // Wait for delegated React onReset handlers to be able to cancel the native reset.
      resetTimeout.start(0, () => resetPicker(event))
    }
    form.addEventListener('reset', reset)
    return () => {
      form.removeEventListener('reset', reset)
      resetTimeout.clear()
    }
  }, [props.form, formElementRef, resetPicker, resetTimeout])

  return (
    <DirectionProvider direction={direction}>
      <PickerContext.Provider
        value={{
          ...props,
          disabled,
          direction,
          invalid,
          displayValue,
          serializedValue,
          triggerId,
          valueId: `${id}-value`,
          labelId:
            Array.from(new Set([fieldLabelId, labelId].filter(Boolean))).join(' ') || undefined,
          setLabelId,
          errorId: errorMessage ? `${id}-error` : '',
          requiredId: `${id}-required`,
          triggerRef,
          clearRef,
          popupRef,
          canEdit,
          focus,
          releaseFocus,
          blur,
          clear: (event) => {
            if (!canEdit()) return
            const details = createChangeEventDetails(
              'clear-press',
              event.nativeEvent,
              event.currentTarget,
            )
            if (!onClear(details)) return
            triggerRef.current?.focus()
            actionsRef.current?.close()
          },
          close: () => actionsRef.current?.close(),
        }}
      >
        {props.required && (
          <span id={`${id}-required`} style={visuallyHidden}>
            {props.requiredLabel ?? 'Required'}
          </span>
        )}
        <input
          {...field.validation.getValidationProps(disabled)}
          ref={mergedInputRef}
          style={name ? visuallyHiddenInput : visuallyHidden}
          aria-hidden="true"
          tabIndex={-1}
          type="text"
          autoComplete="off"
          name={name}
          form={props.form}
          value={serializedValue}
          required={props.required}
          disabled={disabled}
          readOnly={props.readOnly}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus({ focusVisible: true })}
          onInvalid={(event) => {
            event.preventDefault()
            setValidationAttempted(true)
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
        <Popover
          open={props.open}
          defaultOpen={props.defaultOpen}
          onOpenChange={(open, details) => {
            if (open && !canEdit()) details.cancel()
            props.onOpenChange?.(open, details)
            if (
              !details.isCanceled &&
              !open &&
              (details.reason === 'focus-out' || details.reason === 'outside-press')
            ) {
              if (details.reason === 'outside-press') {
                const document = ownerDocument(inputRef.current)
                const pressedLabel = [fieldLabelId, labelId].some((id) => {
                  const label = id ? document.getElementById(id) : null
                  return (
                    label &&
                    isLabelTextInteraction({
                      nativeEvent: details.event,
                      currentTarget: label,
                    })
                  )
                })
                if (pressedLabel) return
              }
              const target =
                details.reason === 'outside-press'
                  ? getTarget(details.event)
                  : 'relatedTarget' in details.event
                    ? details.event.relatedTarget
                    : null
              blur(target instanceof ownerWindow(inputRef.current).Element ? target : null)
            }
          }}
          actionsRef={actionsRef}
        >
          {children}
        </Popover>
        {errorMessage && (
          <span id={`${id}-error`} role="alert" className="system-xs-regular text-text-destructive">
            {errorMessage}
          </span>
        )}
      </PickerContext.Provider>
    </DirectionProvider>
  )
}

type PickerLabelProps = Omit<BaseUIComponentProps<'div', Field.Root.State>, 'id' | 'render'>

function isLabelTextInteraction(
  event: Pick<React.SyntheticEvent<Element>, 'nativeEvent' | 'currentTarget'>,
) {
  const path = event.nativeEvent.composedPath()
  const boundary = path.indexOf(event.currentTarget)
  const ElementConstructor = event.currentTarget.ownerDocument.defaultView?.Element
  if (boundary < 0 || !ElementConstructor) return false
  return !path
    .slice(0, boundary)
    .some(
      (target) =>
        target instanceof ElementConstructor &&
        target.matches(
          'button,a[href],input,select,textarea,summary,[tabindex],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"]',
        ),
    )
}

function PickerLabel({ className, style, ...props }: PickerLabelProps) {
  const { disabled, triggerId, triggerRef, setLabelId } = usePickerContext()
  const field = useFieldRootContext()
  const labelProps = useLabel({
    fallbackControlId: triggerId,
    setLabelId,
    focusControl(event) {
      if (!event.defaultPrevented && !disabled && isLabelTextInteraction(event))
        triggerRef.current?.focus({ focusVisible: true })
    },
  })
  return useRenderElement(
    'div',
    {
      ...props,
      style,
      className: (state: Field.Root.State) =>
        cn(formLabelClassName, resolveClassName(className, state)),
    },
    {
      state: { ...field.state, disabled: Boolean(disabled) },
      stateAttributesMapping: fieldValidityMapping,
      props: [
        {
          ...labelProps,
          onClick(event: React.MouseEvent<HTMLDivElement>) {
            if (!event.defaultPrevented && !disabled && isLabelTextInteraction(event))
              labelProps.onClick?.(event)
          },
          onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
            if (
              !event.defaultPrevented &&
              !disabled &&
              event.button === 0 &&
              isLabelTextInteraction(event)
            )
              labelProps.onPointerDown?.(event)
          },
        },
        props,
      ],
    },
  )
}

type PickerTriggerProps = Omit<
  PopoverTriggerProps,
  'handle' | 'payload' | 'openOnHover' | 'delay' | 'closeDelay' | 'render' | 'nativeButton' | 'ref'
> & {
  ref?: React.Ref<HTMLButtonElement>
}
function PickerTrigger({
  ref,
  id,
  children,
  className,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: PickerTriggerProps) {
  const field = usePickerContext()
  const baseField = useFieldRootContext()
  const triggerId = useLabelableId({ id })
  const focusRef = usePickerFocusRef(field.triggerRef, Boolean(field.disabled || disabled))
  const mergedRef = useMergedRefs(field.triggerRef, ref, focusRef)
  const labelId = ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)
  return (
    <PopoverTrigger
      id={triggerId}
      dir={field.direction}
      aria-label={ariaLabel}
      aria-labelledby={
        labelId
          ? [labelId, field.serializedValue ? field.valueId : undefined].filter(Boolean).join(' ')
          : undefined
      }
      {...getStateAttributesProps(
        {
          ...baseField.state,
          disabled: Boolean(field.disabled || disabled),
          valid: field.invalid ? false : baseField.state.valid,
        },
        fieldValidityMapping,
      )}
      data-readonly={field.readOnly || undefined}
      data-required={field.required || undefined}
      aria-invalid={field.invalid || undefined}
      aria-disabled={field.readOnly || undefined}
      {...mergeProps(
        baseField.validation.getValidationProps(Boolean(field.disabled), {
          'aria-describedby':
            [ariaDescribedBy, field.required ? field.requiredId : undefined, field.errorId]
              .filter(Boolean)
              .join(' ') || undefined,
          onFocus: (event) => field.focus(event.currentTarget),
          onBlur: (event) => field.blur(event.relatedTarget),
        }),
        props,
      )}
      ref={mergedRef}
      disabled={field.disabled || disabled}
      className={(state) =>
        cn(
          'flex h-8 w-63 max-w-full items-center justify-between gap-0.5 rounded-lg bg-components-input-bg-normal ps-3 pe-2 text-start system-sm-regular text-components-input-text-filled',
          'hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
          'aria-invalid:not-data-disabled:bg-components-input-bg-destructive aria-invalid:not-data-disabled:inset-ring-1 aria-invalid:not-data-disabled:inset-ring-components-input-border-destructive',
          'aria-disabled:not-data-disabled:cursor-default data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled',
          !field.serializedValue && 'text-text-tertiary in-data-[theme=dark]:text-text-secondary',
          resolveClassName(className, state),
        )
      }
    >
      {children ?? (
        <React.Fragment>
          <PickerValue />
          <span
            className="i-ri-calendar-line size-4 shrink-0 text-text-tertiary forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
            aria-hidden="true"
          />
        </React.Fragment>
      )}
    </PopoverTrigger>
  )
}

type PickerValueProps = Omit<React.ComponentProps<'span'>, 'children' | 'id'> & {
  /** Receives the formatted committed value, or the placeholder when empty. */
  children?: React.ReactNode | ((displayValue: string) => React.ReactNode)
}
function PickerValue({ children, ...props }: PickerValueProps) {
  const field = usePickerContext()
  const displayValue = field.serializedValue ? field.displayValue : (field.placeholder ?? '')
  return (
    <span {...props} id={field.valueId}>
      {typeof children === 'function' ? children(displayValue) : (children ?? displayValue)}
    </span>
  )
}

// Preserve IconButton's accessible-name union when removing picker-owned props.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

type PickerClearProps = DistributiveOmit<
  IconButtonProps,
  'children' | 'size' | 'render' | 'nativeButton' | 'ref'
> & {
  ref?: React.Ref<HTMLButtonElement>
}
function PickerClear({ onClick, disabled, ref, ...props }: PickerClearProps) {
  const field = usePickerContext()
  const focusRef = usePickerFocusRef(field.clearRef, Boolean(field.disabled || disabled))
  const mergedRef = useMergedRefs(field.clearRef, ref, focusRef)
  if (!field.serializedValue || field.readOnly) return null
  return (
    <IconButton
      {...props}
      onFocus={
        mergeProps(
          {
            onFocus: (event: React.FocusEvent<HTMLButtonElement>) =>
              field.focus(event.currentTarget),
          },
          props,
        ).onFocus
      }
      onBlur={
        mergeProps(
          {
            onBlur: (event: React.FocusEvent<HTMLButtonElement>) => field.blur(event.relatedTarget),
          },
          props,
        ).onBlur
      }
      ref={mergedRef}
      size="lg"
      disabled={field.disabled || disabled}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && !event.baseUIHandlerPrevented) field.clear(event)
      }}
    >
      <span
        className="i-ri-close-line size-4 forced-colors:text-[ButtonText] forced-colors:forced-color-adjust-none"
        aria-hidden="true"
      />
    </IconButton>
  )
}

type PickerContentProps = Omit<PopoverContentProps, 'children' | 'initialFocus' | 'render'>
function PickerContent({
  children,
  ref,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: PickerContentProps & { children: React.ReactNode }) {
  const { labelId, popupRef, focus, blur } = usePickerContext()
  const direction = useDirection()
  const focusRef = usePickerFocusRef(popupRef)
  const mergedRef = useMergedRefs(popupRef, ref, focusRef)
  return (
    <PopoverContent
      side="bottom"
      align="start"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : labelId)}
      dir={direction}
      {...mergeProps(
        {
          onFocus: (event: React.FocusEvent<HTMLDivElement>) => focus(event.currentTarget),
          onBlur: (event: React.FocusEvent<HTMLDivElement>) => blur(event.relatedTarget),
        },
        props,
      )}
      ref={mergedRef}
      className={(state) =>
        cn(
          'forced-colors:[&_button:focus-visible]:outline-2 forced-colors:[&_button:focus-visible]:outline-[Highlight] forced-colors:[&_button:focus-visible]:outline-solid',
          'flex w-63 max-w-(--available-width) flex-col overflow-hidden border-0 p-0 inset-ring-[0.5px] inset-ring-components-panel-border backdrop-blur-[5px]',
          resolveClassName(className, state),
        )
      }
      initialFocus={() =>
        popupRef.current?.querySelector<HTMLElement>(
          '[data-picker-initial-focus], [role="grid"] button[tabindex="0"], [role="option"][aria-selected="true"]',
        ) ??
        popupRef.current?.querySelector<HTMLElement>('button:not(:disabled)') ??
        true
      }
      render={(popupProps, state) => <div {...popupProps}>{state.open ? children : null}</div>}
    >
      {children}
    </PopoverContent>
  )
}

export {
  PickerClear,
  PickerContent,
  PickerLabel,
  PickerRoot,
  PickerTrigger,
  PickerValue,
  usePickerContext,
}
export type {
  PickerClearProps,
  PickerContentProps,
  PickerFieldProps,
  PickerLabelProps,
  PickerTriggerProps,
  PickerValueProps,
}
