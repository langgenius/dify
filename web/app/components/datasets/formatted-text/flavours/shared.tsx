import type { ComponentProps, FC } from 'react'
import classNames from '@/utils/classnames'

const baseStyle = 'py-[3px]'

export type SliceContainerProps = ComponentProps<'span'>

export const SliceContainer: FC<SliceContainerProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    'group mr-1 select-none align-bottom text-sm',
    className,
  )} />
}
SliceContainer.displayName = 'SliceContainer'

export type SliceLabelProps = ComponentProps<'span'> & { labelInnerClassName?: string }

export const SliceLabel: FC<SliceLabelProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, children, labelInnerClassName, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'bg-state-base-hover-alt px-1 uppercase text-text-tertiary group-hover:bg-state-accent-solid group-hover:text-text-primary-on-surface',
    className,
  )}>
    <span className={classNames('text-nowrap', labelInnerClassName)}>
      {children}
    </span>
  </span>
}
SliceLabel.displayName = 'SliceLabel'

export type SliceContentProps = ComponentProps<'span'>

export const SliceContent: FC<SliceContentProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, children, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'whitespace-pre-line break-all bg-state-base-hover px-1 leading-7 group-hover:bg-state-accent-hover-alt group-hover:text-text-primary',
    className,
  )}>
    {children}
  </span>
}
SliceContent.displayName = 'SliceContent'

export type SliceDividerProps = ComponentProps<'span'>

export const SliceDivider: FC<SliceDividerProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'bg-state-base-active px-[1px] text-sm group-hover:bg-state-accent-solid',
    className,
  )}>
    {/* use a zero-width space to make the hover area bigger */}
    &#8203;
  </span>
}
SliceDivider.displayName = 'SliceDivider'
