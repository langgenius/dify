import type { ReactNode } from 'react'
import type { FieldTitleProps } from '.'
import { FieldTitle } from '.'

export type FieldProps = {
  fieldTitleProps: FieldTitleProps
  children: ReactNode
}
export const Field = ({
  fieldTitleProps,
  children,
}: FieldProps) => {
  return (
    <div>
      <FieldTitle {...fieldTitleProps} />
      {children}
    </div>
  )
}
