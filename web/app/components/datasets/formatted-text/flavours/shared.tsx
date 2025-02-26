import { type ComponentProps, type FC, forwardRef } from 'react'
import classNames from '@/utils/classnames'

const baseStyle = 'py-[3px]'

export type SliceContainerProps = ComponentProps<'span'>

export const SliceContainer: FC<SliceContainerProps> = forwardRef((props, ref) => {
  const { className, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    'group align-bottom mr-1 select-none text-sm',
    className,
  )} />
})
SliceContainer.displayName = 'SliceContainer'

export type SliceLabelProps = ComponentProps<'span'> & { labelInnerClassName?: string }

export const SliceLabel: FC<SliceLabelProps> = forwardRef((props, ref) => {
  const { className, children, labelInnerClassName, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'px-1 bg-state-base-hover-alt group-hover:bg-state-accent-solid group-hover:text-text-primary-on-surface uppercase text-text-tertiary',
    className,
  )}>
    <span className={classNames('text-nowrap', labelInnerClassName)}>
      {children}
    </span>
  </span>
})
SliceLabel.displayName = 'SliceLabel'

export type SliceContentProps = ComponentProps<'span'>

export const SliceContent: FC<SliceContentProps> = forwardRef((props, ref) => {
  const { className, children, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'px-1 bg-state-base-hover group-hover:bg-state-accent-hover-alt group-hover:text-text-primary leading-7 whitespace-pre-line break-all',
    className,
  )}>
    {children}
  </span>
})
SliceContent.displayName = 'SliceContent'

export type SliceDividerProps = ComponentProps<'span'>

export const SliceDivider: FC<SliceDividerProps> = forwardRef((props, ref) => {
  const { className, ...rest } = props
  return <span {...rest} ref={ref} className={classNames(
    baseStyle,
    'bg-state-base-active group-hover:bg-state-accent-solid text-sm px-[1px]',
    className,
  )}>
    {/* use a zero-width space to make the hover area bigger */}
    &#8203;
  </span>
})
SliceDivider.displayName = 'SliceDivider'
