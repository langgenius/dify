import s from './index.module.css'
import cn from '@/utils/classnames'
import type { DataSourceNotionPage } from '@/models/common'

type IconTypes = 'workspace' | 'page'
type NotionIconProps = {
  type?: IconTypes
  name?: string | null
  className?: string
  src?: string | null | DataSourceNotionPage['page_icon']
}
const NotionIcon = ({
  type = 'workspace',
  src,
  name,
  className,
}: NotionIconProps) => {
  if (type === 'workspace') {
    if (typeof src === 'string') {
      if (src.startsWith('https://') || src.startsWith('http://')) {
        return (
          <img
            alt='workspace icon'
            src={src}
            className={cn('block h-5 w-5 object-cover', className)}
          />
        )
      }
      return (
        <div className={cn('flex h-5 w-5 items-center justify-center', className)}>{src}</div>
      )
    }
    return (
      <div className={cn('flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-xs font-medium text-gray-500', className)}>{name?.[0].toLocaleUpperCase()}</div>
    )
  }

  if (typeof src === 'object' && src !== null) {
    if (src?.type === 'url') {
      return (
        <img
          alt='page icon'
          src={src.url || ''}
          className={cn('block h-5 w-5 object-cover', className)}
        />
      )
    }
    return (
      <div className={cn('flex h-5 w-5 items-center justify-center', className)}>{src?.emoji}</div>
    )
  }

  return (
    <div className={cn(s['default-page-icon'], className)} />
  )
}

export default NotionIcon
