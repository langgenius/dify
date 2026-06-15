import type { ComponentProps, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type PreviewHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  title: string
}

export const PreviewHeader: FC<PreviewHeaderProps> = (props) => {
  const { title, className, children, ...rest } = props
  return (
    <div
      {...rest}
      className={cn(className)}
    >
      <div
        className="mb-1 px-1 system-2xs-semibold-uppercase text-text-accent uppercase"
      >
        {title}
      </div>
      {children}
    </div>
  )
}
