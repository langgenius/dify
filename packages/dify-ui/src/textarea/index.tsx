'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Field as BaseField } from '@base-ui/react/field'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { textControlClassName } from '../form-control-shared'
import { resolveClassName } from '../internals/resolve-class-name'

const textareaVariants = cva([textControlClassName, 'min-h-20 overflow-auto'], {
  variants: {
    size: {
      small: 'rounded-md px-2 py-1 system-xs-regular',
      medium: 'rounded-lg px-3 py-2 system-sm-regular',
      large: 'rounded-[10px] px-4 py-2 system-md-regular',
    },
  },
  defaultVariants: {
    size: 'medium',
  },
})

type TextareaValue = string | number
type TextareaChangeEventDetails = BaseFieldNS.Control.ChangeEventDetails
type TextareaOnValueChange = (value: string, eventDetails: TextareaChangeEventDetails) => void

type ControlledTextareaProps = {
  value: TextareaValue
  defaultValue?: never
  onValueChange: TextareaOnValueChange
}

type UncontrolledTextareaProps = {
  value?: never
  defaultValue?: TextareaValue
  onValueChange?: TextareaOnValueChange
}

type TextareaNativeProps = React.ComponentPropsWithRef<'textarea'>
type TextareaOnlyProps = Pick<TextareaNativeProps, 'cols' | 'rows' | 'wrap'>
type TextareaElementProps = Omit<
  TextareaNativeProps,
  | 'children'
  | 'className'
  | 'cols'
  | 'defaultValue'
  | 'onChange'
  | 'rows'
  | 'size'
  | 'style'
  | 'value'
  | 'wrap'
>

type TextareaControlProps = ControlledTextareaProps | UncontrolledTextareaProps
type TextareaVariantProps = VariantProps<typeof textareaVariants>
type FieldControlTextareaProps = Omit<
  BaseFieldNS.Control.Props,
  'className' | 'defaultValue' | 'onValueChange' | 'render' | 'value'
>

type TextareaProps = TextareaElementProps &
  Pick<BaseFieldNS.Control.Props, 'className' | 'style'> &
  TextareaOnlyProps &
  TextareaControlProps &
  TextareaVariantProps & {
    children?: never
  }

function Textarea({
  className,
  cols,
  defaultValue,
  onValueChange,
  ref,
  rows,
  size = 'medium',
  value,
  wrap,
  ...controlProps
}: TextareaProps) {
  // Base UI types Field.Control as an input even when render replaces it with a textarea.
  const fieldControlProps = controlProps as FieldControlTextareaProps

  return (
    <BaseField.Control
      {...fieldControlProps}
      className={(state) => cn(textareaVariants({ size }), resolveClassName(className, state))}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      ref={ref}
      render={<textarea cols={cols} rows={rows} wrap={wrap} />}
      value={value}
    />
  )
}

export { Textarea }

export type { TextareaProps }
