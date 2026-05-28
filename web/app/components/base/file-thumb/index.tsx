import type { VariantProps } from 'class-variance-authority'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { useCallback } from 'react'
import { FileTypeIcon } from '../file-uploader'
import { getFileAppearanceType } from '../file-uploader/utils'
import ImageRender from './image-render'

const FileThumbVariants = cva(
  'flex cursor-pointer items-center justify-center',
  {
    variants: {
      size: {
        sm: 'size-6',
        md: 'size-8',
      },
    },
    defaultVariants: {
      size: 'sm',
    },
  },
)

export type FileEntity = {
  name: string
  size: number
  extension: string
  mimeType: string
  sourceUrl: string
}

type FileThumbProps = {
  file: FileEntity
  className?: string
  onClick?: (file: FileEntity) => void
} & VariantProps<typeof FileThumbVariants>

const FileThumb = ({
  file,
  size,
  className,
  onClick,
}: FileThumbProps) => {
  const { name, mimeType, sourceUrl } = file
  const isImage = mimeType.startsWith('image/')

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClick?.(file)
  }, [onClick, file])

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={name}
            className={cn(
              FileThumbVariants({ size, className }),
              'border-0 bg-transparent p-0',
              isImage
                ? 'p-px'
                : 'rounded-md border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs hover:bg-components-panel-on-panel-item-bg-alt',
            )}
            onClick={handleClick}
          >
            {
              isImage
                ? (
                    <ImageRender
                      sourceUrl={sourceUrl}
                      name={name}
                    />
                  )
                : (
                    <FileTypeIcon
                      type={getFileAppearanceType(name, mimeType)}
                      size="sm"
                    />
                  )
            }
          </button>
        )}
      />
      <TooltipContent placement="top" className="rounded-lg p-1.5 system-xs-medium text-text-secondary">
        {name}
      </TooltipContent>
    </Tooltip>
  )
}

export default React.memo(FileThumb)
