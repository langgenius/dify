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
      className='text-text-accent text-2xs font-semibold leading-3 uppercase'
    >
      {title}
    </div>
    {children}
  </div>
}
