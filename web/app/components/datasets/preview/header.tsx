import type { ComponentProps, FC } from 'react'
import classNames from '@/utils/classnames'

export type PreviewHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  title: string
}

export const PreviewHeader: FC<PreviewHeaderProps> = (props) => {
  const { title, className, children, ...rest } = props
  return <div
    {...rest}
    className={classNames(
      className,
    )}
  >
    <div
      className='text-text-accent system-2xs-semibold-uppercase mb-1 px-1 uppercase'
    >
      {title}
    </div>
    {children}
  </div>
}
