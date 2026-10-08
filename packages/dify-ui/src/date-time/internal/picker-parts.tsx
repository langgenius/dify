'use client'

import type { IconButtonProps } from '../../icon-button'
import type {
  PopoverActions,
  PopoverContentProps,
  PopoverProps,
  PopoverTriggerProps,
} from '../../popover'
import { useMergedRefs } from '@base-ui/utils/useMergedRefs'
import * as React from 'react'
import { cn } from '../../cn'
import { DirectionProvider, useDirection } from '../../direction-provider'
import { formLabelClassName } from '../../form-control-shared'
import { IconButton } from '../../icon-button'
import { resolveClassName } from '../../internals/resolve-class-name'
import { Popover, PopoverContent, PopoverTrigger } from '../../popover'

type PickerOpenChangeDetails = Omit<
  Parameters<NonNullable<PopoverProps['onOpenChange']>>[1],
  'preventUnmountOnClose'
>

type PickerFieldProps = Pick<PopoverProps, 'open' | 'defaultOpen'> & {
  /** Overrides DirectionProvider for this field and its popup; independent of locale. */
  direction?: DirectionProvider.Props['direction']
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
  triggerId: string
  valueId: string
  labelId: string | undefined
  setLabelId: React.Dispatch<React.SetStateAction<string | undefined>>
  errorId: string
  requiredId: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  clear: () => void
  close: () => void
}

const PickerContext = React.createContext<PickerContextValue | null>(null)

function usePickerContext() {
  const context = React.useContext(PickerContext)
  if (!context) throw new Error('Picker parts must be inside their picker root.')
  return context
}

function PickerRoot({
  displayValue,
  serializedValue,
  onClear,
  onReset,
  children,
  ...props
}: PickerFieldProps & {
  displayValue: string
  serializedValue: string
  onClear: () => void
  onReset: () => void
}) {
  const inheritedDirection = useDirection()
  const direction = props.direction ?? inheritedDirection
  const id = React.useId()
  const [labelId, setLabelId] = React.useState<string>()
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const actionsRef = React.useRef<PopoverActions>(null)
  const [validationAttempted, setValidationAttempted] = React.useState(false)
  const errorMessage = props.invalid
    ? (props.validationMessage ?? 'Choose a valid value.')
    : validationAttempted && props.required && !serializedValue
      ? (props.validationMessage ?? 'Choose a value.')
      : undefined
  const invalid = Boolean(errorMessage)
  React.useEffect(() => {
    inputRef.current?.setCustomValidity(
      props.invalid ? (props.validationMessage ?? 'Choose a valid value.') : '',
    )
  }, [props.invalid, props.validationMessage])
  const onResetEvent = React.useEffectEvent(onReset)
  React.useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    function reset(event: Event) {
      queueMicrotask(() => {
        if (event.defaultPrevented) return
        setValidationAttempted(false)
        onResetEvent()
        actionsRef.current?.close()
      })
    }
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [props.form])

  return (
    <DirectionProvider direction={direction}>
      <PickerContext.Provider
        value={{
          ...props,
          direction,
          invalid,
          displayValue,
          serializedValue,
          triggerId: `${id}-trigger`,
          valueId: `${id}-value`,
          labelId,
          setLabelId,
          errorId: `${id}-error`,
          requiredId: `${id}-required`,
          triggerRef,
          clear: () => {
            if (props.disabled || props.readOnly) return
            triggerRef.current?.focus()
            onClear()
            actionsRef.current?.close()
          },
          close: () => actionsRef.current?.close(),
        }}
      >
        {props.required && (
          <span id={`${id}-required`} className="sr-only">
            {props.requiredLabel ?? 'Required'}
          </span>
        )}
        <input
          ref={inputRef}
          hidden
          tabIndex={-1}
          type="text"
          autoComplete="off"
          name={props.name}
          form={props.form}
          value={serializedValue}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault()
            setValidationAttempted(true)
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
            if (open && (props.disabled || props.readOnly)) details.cancel()
            props.onOpenChange?.(open, details)
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

type PickerLabelProps = Omit<React.ComponentProps<'div'>, 'id'>

function isLabelTextInteraction(event: React.SyntheticEvent<HTMLDivElement>) {
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

function PickerLabel({ children, className, onClick, onPointerDown, ...props }: PickerLabelProps) {
  const { disabled, triggerRef, setLabelId } = usePickerContext()
  const id = React.useId()
  React.useLayoutEffect(() => {
    setLabelId(id)
    return () => setLabelId(undefined)
  }, [id, setLabelId])

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- The label only forwards focus; the native trigger owns keyboard activation.
    <div
      {...props}
      id={id}
      data-disabled={disabled || undefined}
      className={cn(formLabelClassName, className)}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (
          !event.defaultPrevented &&
          !disabled &&
          event.button === 0 &&
          isLabelTextInteraction(event)
        )
          event.preventDefault()
      }}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled || !isLabelTextInteraction(event)) return
        triggerRef.current?.focus({ focusVisible: true })
      }}
    >
      {children}
    </div>
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
  children,
  className,
  disabled,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: PickerTriggerProps) {
  const field = usePickerContext()
  const mergedRef = useMergedRefs(field.triggerRef, ref)
  const labelId = ariaLabelledBy ?? (ariaLabel ? undefined : field.labelId)
  return (
    <PopoverTrigger
      id={field.triggerId}
      dir={field.direction}
      aria-label={ariaLabel}
      aria-labelledby={
        labelId
          ? [labelId, field.serializedValue ? field.valueId : undefined].filter(Boolean).join(' ')
          : undefined
      }
      aria-describedby={
        [
          ariaDescribedBy,
          field.required ? field.requiredId : undefined,
          field.invalid ? field.errorId : undefined,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      aria-invalid={field.invalid || undefined}
      aria-disabled={field.readOnly || undefined}
      {...props}
      ref={mergedRef}
      disabled={field.disabled || disabled}
      className={(state) =>
        cn(
          'flex h-8 w-63 max-w-full items-center justify-between gap-0.5 rounded-lg bg-components-input-bg-normal ps-3 pe-2 text-start system-sm-regular text-components-input-text-filled',
          'hover:bg-state-base-hover-alt data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-popup-open:bg-state-base-hover-alt',
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
function PickerClear({ onClick, disabled, ...props }: PickerClearProps) {
  const field = usePickerContext()
  if (!field.serializedValue || field.readOnly) return null
  return (
    <IconButton
      {...props}
      size="lg"
      disabled={field.disabled || disabled}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) field.clear()
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
  const { labelId } = usePickerContext()
  const direction = useDirection()
  const popupRef = React.useRef<HTMLDivElement>(null)
  const mergedRef = useMergedRefs(popupRef, ref)
  return (
    <PopoverContent
      placement="bottom-start"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : labelId)}
      dir={direction}
      {...props}
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
