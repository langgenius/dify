export const formLabelClassName =
  'w-fit cursor-default py-1 text-text-secondary system-sm-medium data-disabled:cursor-not-allowed'

// The focus indicator of a control whose checked fill is the indicator color (Switch, Checkbox, Radio).
// The gap keeps it distinct from that fill. The color is set at rest so it does not animate in.
export const checkedControlFocusClassName =
  'outline-state-accent-solid focus-visible:outline-2 focus-visible:outline-offset-2'

// The field surface when the native control is the visible field (Input, Textarea).
// Focus selects `:focus`, not `data-focused`: a text control shows focus however it was reached, and
// Base UI sets `data-focused` only inside a Field. It exposes no read-only attribute on a plain control
// either, so that state uses the pseudo-class, limited to enabled controls because `:read-only` also
// matches a disabled one.
export const textControlClassName = [
  'w-full appearance-none border border-transparent bg-components-input-bg-normal text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color]',
  'placeholder:text-components-input-text-placeholder',
  'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
  'focus:border-transparent focus:bg-components-input-bg-active focus:ring-2 focus:ring-state-accent-solid focus:transition-none',
  'enabled:data-invalid:border-components-input-border-destructive enabled:data-invalid:bg-components-input-bg-destructive',
  'read-only:cursor-default enabled:read-only:not-data-invalid:hover:border-transparent enabled:read-only:not-data-invalid:hover:bg-components-input-bg-normal enabled:read-only:not-data-invalid:focus:bg-components-input-bg-normal',
  'disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled',
  'disabled:hover:border-transparent disabled:hover:bg-components-input-bg-disabled',
  'motion-reduce:transition-none',
]

// The same surface on a Base UI group part that wraps the control (NumberField, Combobox, Autocomplete).
// The group reads focus from its input, so buttons inside it keep their own indicator.
export const textControlGroupClassName = [
  'flex w-full min-w-0 border border-transparent bg-components-input-bg-normal text-components-input-text-filled transition-[background-color,border-color]',
  'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
  'has-[input:focus]:border-transparent has-[input:focus]:bg-components-input-bg-active has-[input:focus]:ring-2 has-[input:focus]:ring-state-accent-solid has-[input:focus]:transition-none',
  'data-invalid:not-data-disabled:border-components-input-border-destructive data-invalid:not-data-disabled:bg-components-input-bg-destructive',
  'data-readonly:not-data-disabled:not-data-invalid:hover:border-transparent data-readonly:not-data-disabled:not-data-invalid:hover:bg-components-input-bg-normal data-readonly:not-data-disabled:not-data-invalid:has-[input:focus]:bg-components-input-bg-normal',
  'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled',
  'data-disabled:hover:border-transparent data-disabled:hover:bg-components-input-bg-disabled',
  'motion-reduce:transition-none',
]
