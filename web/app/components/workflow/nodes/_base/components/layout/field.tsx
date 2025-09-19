import type { ReactNode } from 'react'
import {
  memo,
  useState,
} from 'react'
import type { FieldTitleProps } from '.'
import { FieldTitle } from '.'

export type FieldProps = {
  fieldTitleProps?: FieldTitleProps
  children?: ReactNode
  disabled?: boolean
  supportCollapse?: boolean
}
export const Field = memo(({
  fieldTitleProps,
  children,
  supportCollapse,
  disabled,
}: FieldProps) => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <FieldTitle
        {...fieldTitleProps}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        showArrow={supportCollapse}
        disabled={disabled}
      />
      {supportCollapse && !collapsed && children}
      {!supportCollapse && children}
    </div>
  )
})
