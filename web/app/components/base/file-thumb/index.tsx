import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { FileTypeIcon } from '../file-uploader'
import { getFileAppearanceType } from '../file-uploader/utils'
import ImageRender from './image-render'

const FileThumbVariants = cva('flex cursor-pointer items-center justify-center', {
  variants: {
    size: {
      sm: 'size-6',
      md: 'size-8',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
})

type FileEntity = {
  name: string
  size: number
  extension: string
  mimeType: string
  sourceUrl: string
}

type FileThumbProps = {
  file: FileEntity
} & Omit<ComponentProps<'button'>, 'children'> &
  VariantProps<typeof FileThumbVariants>

export const FileThumb = React.memo(({ file, size, className, ...buttonProps }: FileThumbProps) => {
  const { name, mimeType, sourceUrl } = file
  const isImage = mimeType.startsWith('image/')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={name}
            {...buttonProps}
            className={cn(
              FileThumbVariants({ size, className }),
              'border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid disabled:cursor-default',
              isImage
                ? 'p-px'
                : 'rounded-md border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-alt',
            )}
          >
            {isImage ? (
              <ImageRender sourceUrl={sourceUrl} name={name} />
            ) : (
              <FileTypeIcon type={getFileAppearanceType(name, mimeType)} size="sm" />
            )}
          </button>
        }
      />
      <TooltipContent placement="top">{name}</TooltipContent>
    </Tooltip>
  )
})
