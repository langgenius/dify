import type { ComponentProps, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

const baseStyle = 'py-[3px]'

type SliceContainerProps = ComponentProps<'span'>

export const SliceContainer: FC<SliceContainerProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, ...rest } = props
  return (
    <span
      {...rest}
      ref={ref}
      className={cn('group mr-1 align-bottom text-sm select-none', className)}
    />
  )
}
SliceContainer.displayName = 'SliceContainer'

type SliceLabelProps = ComponentProps<'span'> & { labelInnerClassName?: string }

export const SliceLabel: FC<SliceLabelProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, children, labelInnerClassName, ...rest } = props
  return (
    <span
      {...rest}
      ref={ref}
      className={cn(baseStyle, 'bg-state-base-hover-alt px-1 text-text-tertiary uppercase group-hover:bg-state-accent-solid group-hover:text-text-primary-on-surface', className)}
    >
      <span className={cn('text-nowrap', labelInnerClassName)}>
        {children}
      </span>
    </span>
  )
}
SliceLabel.displayName = 'SliceLabel'

type SliceContentProps = ComponentProps<'span'>

export const SliceContent: FC<SliceContentProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, children, ...rest } = props
  return (
    <span
      {...rest}
      ref={ref}
      className={cn(baseStyle, 'bg-state-base-hover px-1 leading-7 break-all whitespace-pre-line group-hover:bg-state-accent-hover-alt group-hover:text-text-primary', className)}
    >
      {children}
    </span>
  )
}
SliceContent.displayName = 'SliceContent'

type SliceDividerProps = ComponentProps<'span'>

export const SliceDivider: FC<SliceDividerProps> = (
  {
    ref,
    ...props
  },
) => {
  const { className, ...rest } = props
  return (
    <span
      {...rest}
      ref={ref}
      className={cn(baseStyle, 'bg-state-base-active px-px text-sm group-hover:bg-state-accent-solid', className)}
    >
      {/* use a zero-width space to make the hover area bigger */}
      &#8203;
    </span>
  )
}
SliceDivider.displayName = 'SliceDivider'
