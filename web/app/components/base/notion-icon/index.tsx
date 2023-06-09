import cn from 'classnames'
import s from './index.module.css'

type NotionIconProps = {
  type?: 'workspace' | 'page'
  src?: string | null
  name?: string | null
  className?: string
}

const NotionIcon = ({
  type = 'workspace',
  src,
  name,
  className,
}: NotionIconProps) => {
  if (type === 'workspace') {
    if (src) {
      if (src.startsWith('https://') || src.startsWith('http://')) {
        return (
          <img
            alt='workspace icon'
            src={src}
            className={cn('block object-cover w-5 h-5', className)}
          />
        )
      }
      return (
        <div className={cn('flex items-center justify-center w-5 h-5', className)}>{src}</div>
      )
    }
    return (
      <div className={cn('flex items-center justify-center w-5 h-5 bg-gray-200 text-xs font-medium text-gray-500 rounded', className)}>{name?.[0].toLocaleUpperCase()}</div>
    )
  }

  if (src) {
    if (src.startsWith('https://') || src.startsWith('http://')) {
      return (
        <img
          alt='page icon'
          src={src}
          className={cn('block object-cover w-5 h-5', className)}
        />
      )
    }
    return (
      <div className={cn('flex items-center justify-center w-5 h-5', className)}>{src}</div>
    )
  }

  return (
    <div className={cn(s['default-page-icon'], className)} />
  )
}

export default NotionIcon
