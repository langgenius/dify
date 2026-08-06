import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import { basePath } from '@/utils/var'

const difyLogoVariants = cva(
  'block object-contain [html[data-theme=dark]_&]:brightness-0 [html[data-theme=dark]_&]:invert',
  {
    variants: {
      size: {
        small: 'h-4 w-9',
        medium: 'h-5.5 w-12',
        large: 'h-7 w-16',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type DifyLogoProps = Omit<
  ComponentProps<'img'>,
  'alt' | 'height' | 'size' | 'src' | 'width'
> &
  VariantProps<typeof difyLogoVariants> & {
    alt: string
  }

export function DifyLogo({ alt, className, size, ...props }: DifyLogoProps) {
  const classes = cn(difyLogoVariants({ size, className }))

  return (
    <img
      {...props}
      src={`${basePath}/logo/logo.svg`}
      width={48}
      height={22}
      className={classes}
      alt={alt}
    />
  )
}
