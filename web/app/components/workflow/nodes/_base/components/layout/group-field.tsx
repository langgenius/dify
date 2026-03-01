import type { ReactNode } from 'react'
import type {
  FieldProps,
  GroupProps,
} from '.'
import { memo } from 'react'
import {
  Field,
  Group,
} from '.'

type GroupFieldProps = {
  children?: ReactNode
  groupProps?: Omit<GroupProps, 'children'>
  fieldProps?: Omit<FieldProps, 'children'>
}
export const GroupField = memo(({
  children,
  fieldProps,
  groupProps,
}: GroupFieldProps) => {
  return (
    <Group {...groupProps}>
      <Field {...fieldProps}>
        {children}
      </Field>
    </Group>
  )
})
