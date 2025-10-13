import type { ReactNode } from 'react'
import { memo } from 'react'
import type {
  BoxGroupProps,
  FieldProps,
} from '.'
import {
  BoxGroup,
  Field,
} from '.'

type BoxGroupFieldProps = {
  children?: ReactNode
  boxGroupProps?: Omit<BoxGroupProps, 'children'>
  fieldProps?: Omit<FieldProps, 'children'>
}
export const BoxGroupField = memo(({
  children,
  fieldProps,
  boxGroupProps,
}: BoxGroupFieldProps) => {
  return (
    <BoxGroup {...boxGroupProps}>
      <Field {...fieldProps}>
        {children}
      </Field>
    </BoxGroup>
  )
})
