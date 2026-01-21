import type { ComponentProps, FC } from 'react'
import { cn } from '@/utils/classnames'

export type PreviewHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
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
        className="system-2xs-semibold-uppercase mb-1 px-1 uppercase text-text-accent"
      >
        {title}
      </div>
      {children}
    </div>
  )
}
