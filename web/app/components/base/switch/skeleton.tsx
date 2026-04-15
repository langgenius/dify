import type { SwitchSize } from './index'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'

const skeletonVariants = cva(
  'bg-text-quaternary opacity-20',
  {
    variants: {
      size: {
        xs: 'h-2.5 w-3.5 rounded-xs',
        sm: 'h-3 w-5 rounded-[3.5px]',
        md: 'h-4 w-7 rounded-[5px]',
        lg: 'h-5 w-9 rounded-md',
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
