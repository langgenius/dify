import type { FC } from 'react'
import type { DividerProps } from '.'
import Divider from '.'
import classNames from '@/utils/classnames'

export type DividerWithLabelProps = DividerProps & {
  label: string
}

export const DividerWithLabel: FC<DividerWithLabelProps> = (props) => {
  const { label, className, ...rest } = props
  return <div
    className="flex items-center gap-2 my-2"
  >
    <Divider {...rest} className={classNames('flex-1', className)} />
    <span className="text-text-tertiary text-xs">
      {label}
    </span>
    <Divider {...rest} className={classNames('flex-1', className)} />
  </div>
}

export default DividerWithLabel
