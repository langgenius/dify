import type { DataSourceNotionPage } from '@/models/common'
import { cn } from '@langgenius/dify-ui/cn'
import { RiFileTextLine } from '@remixicon/react'

type IconTypes = 'workspace' | 'page'
type NotionIconProps = {
  type?: IconTypes
  name?: string | null
  className?: string
  decorative?: boolean
  src?: string | null | DataSourceNotionPage['page_icon']
}
const NotionIcon = ({
  type = 'workspace',
  src,
  name,
  className,
  decorative = false,
}: NotionIconProps) => {
  if (type === 'workspace') {
    if (typeof src === 'string') {
      if (src.startsWith('https://') || src.startsWith('http://')) {
        return (
          <img
            alt={decorative ? '' : 'workspace icon'}
            src={src}
            className={cn('block size-5 object-cover', className)}
          />
        )
      }
      return (
        <div
          aria-hidden={decorative || undefined}
          className={cn('flex size-5 items-center justify-center', className)}
        >
          {src}
        </div>
      )
    }
    return (
      <div
        aria-hidden={decorative || undefined}
        className={cn(
          'flex size-5 items-center justify-center rounded-sm bg-gray-200 text-xs font-medium text-gray-500',
          className,
        )}
      >
        {name?.[0]!.toLocaleUpperCase()}
      </div>
    )
  }

  if (typeof src === 'object' && src !== null) {
    if (src?.type === 'url') {
      return (
        <img
          alt={decorative ? '' : 'page icon'}
          src={src.url || ''}
          className={cn('block size-5 object-cover', className)}
        />
      )
    }
    return (
      <div
        aria-hidden={decorative || undefined}
        className={cn('flex size-5 items-center justify-center', className)}
      >
        {src?.emoji}
      </div>
    )
  }

  return (
    <RiFileTextLine
      aria-hidden={decorative || undefined}
      className={cn('size-5 text-text-tertiary', className)}
    />
  )
}

export default NotionIcon
