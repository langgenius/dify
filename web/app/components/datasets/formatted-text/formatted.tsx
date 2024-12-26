import type { ComponentProps, FC } from 'react'
import classNames from '@/utils/classnames'

export type FormattedTextProps = ComponentProps<'p'>

export const FormattedText: FC<FormattedTextProps> = (props) => {
  const { className, ...rest } = props
  return <p
    {...rest}
    className={classNames('leading-7', className)}
  >{props.children}</p>
}
