import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { useCallback } from 'react'
import { cn } from '@/utils/classnames'
import { FileTypeIcon } from '../file-uploader'
import { getFileAppearanceType } from '../file-uploader/utils'
import Tooltip from '../tooltip'
import ImageRender from './image-render'

const FileThumbVariants = cva(
  'flex items-center justify-center cursor-pointer',
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

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onClick?.(file)
  }, [onClick, file])

  return (
    <Tooltip
      popupContent={name}
      popupClassName="p-1.5 rounded-lg system-xs-medium text-text-secondary"
      position="top"
    >
      <div
        className={cn(
          FileThumbVariants({ size, className }),
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
      </div>
    </Tooltip>
  )
}

export default React.memo(FileThumb)
