import type { ComponentProps, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type FormattedTextProps = ComponentProps<'p'>

export const FormattedText: FC<FormattedTextProps> = (props) => {
  const { className, ...rest } = props
  return (
    <p
      {...rest}
      className={cn('leading-7', className)}
    >
      {props.children}
    </p>
  )
}
