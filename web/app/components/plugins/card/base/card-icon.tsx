import { RiCheckLine, RiCloseLine } from '@remixicon/react'
import AppIcon from '@/app/components/base/app-icon'
import cn from '@/utils/classnames'

const iconSizeMap = {
  xs: 'w-4 h-4 text-base',
  tiny: 'w-6 h-6 text-base',
  small: 'w-8 h-8',
  medium: 'w-9 h-9',
  large: 'w-10 h-10',
}
const Icon = ({
  className,
  src,
  installed = false,
  installFailed = false,
  size = 'large',
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
          size={size}
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
      className={cn('shrink-0 relative rounded-md bg-center bg-no-repeat bg-contain', iconSizeMap[size], className)}
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
