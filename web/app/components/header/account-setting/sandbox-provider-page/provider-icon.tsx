import { cn } from '@/utils/classnames'
import { PROVIDER_ICONS } from './constants'

type ProviderIconProps = {
  providerType: string
  size?: 'sm' | 'md'
  withBorder?: boolean
}

const ProviderIcon = ({ providerType, size = 'md', withBorder = false }: ProviderIconProps) => {
  const iconSrc = PROVIDER_ICONS[providerType] || PROVIDER_ICONS.e2b
  const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'

  if (withBorder) {
    return (
      <div className={cn('shrink-0 text-clip rounded border-[0.5px] border-divider-subtle', sizeClass)}>
        <img
          src={iconSrc}
          alt={`${providerType} icon`}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <img
      src={iconSrc}
      alt={`${providerType} icon`}
      className={sizeClass}
    />
  )
}

export default ProviderIcon
