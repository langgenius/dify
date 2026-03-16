import type { SwitchSize } from './index'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/classnames'

const skeletonVariants = cva(
  'bg-text-quaternary opacity-20',
  {
    variants: {
      size: {
        xs: 'h-2.5 w-3.5 rounded-[2px]',
        sm: 'h-3 w-5 rounded-[3.5px]',
        md: 'h-4 w-7 rounded-[5px]',
        lg: 'h-5 w-9 rounded-[6px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

type SwitchSkeletonProps = {
  'size'?: SwitchSize
  'className'?: string
  'data-testid'?: string
}

export function SwitchSkeleton({
  size = 'md',
  className,
  'data-testid': dataTestid,
}: SwitchSkeletonProps) {
  return (
    <div
      className={cn(skeletonVariants({ size }), className)}
      data-testid={dataTestid}
    />
  )
}

SwitchSkeleton.displayName = 'SwitchSkeleton'
