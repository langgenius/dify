import { RiCheckLine, RiCloseLine } from '@remixicon/react'
import AppIcon from '@/app/components/base/app-icon'
import cn from '@/utils/classnames'

const Icon = ({
  className,
  src,
  installed = false,
  installFailed = false,
  size,
}: {
  className?: string
  src: string | {
    content: string
    background: string
  }
  installed?: boolean
  installFailed?: boolean
  size?: 'xs' | 'tiny' | 'small' | 'medium' | 'large'
}) => {
  const iconClassName = 'flex justify-center items-center gap-2 absolute bottom-[-4px] right-[-4px] w-[18px] h-[18px] rounded-full border-2 border-components-panel-bg'
  if (typeof src === 'object') {
    return (
      <div className={cn('relative', className)}>
        <AppIcon
          size={size || 'large'}
          iconType={'emoji'}
          icon={src.content}
          background={src.background}
          className='rounded-md'
        />
      </div>
    )
  }
  return (
    <div
      className={cn('shrink-0 relative w-10 h-10 rounded-md bg-center bg-no-repeat bg-contain', className)}
      style={{
        backgroundImage: `url(${src})`,
      }}
    >
      {
        installed
        && <div className={cn(iconClassName, 'bg-state-success-solid')}>
          <RiCheckLine className='w-3 h-3 text-text-primary-on-surface' />
        </div>
      }
      {
        installFailed
        && <div className={cn(iconClassName, 'bg-state-destructive-solid')}>
          <RiCloseLine className='w-3 h-3 text-text-primary-on-surface' />
        </div>
      }
    </div>
  )
}

export default Icon
