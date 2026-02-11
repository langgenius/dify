import DockerMarkWhite from '@/app/components/base/icons/src/public/common/DockerMarkWhite'
import E2B from '@/app/components/base/icons/src/public/common/E2B'
import SandboxLocal from '@/app/components/base/icons/src/public/common/SandboxLocal'
import { cn } from '@/utils/classnames'
import { PROVIDER_ICONS } from './constants'

type ProviderIconProps = {
  providerType: string
  size?: 'sm' | 'md'
  withBorder?: boolean
}

const DOCKER_BRAND_BLUE = '#1D63ED'
const SSH_CONSOLE_BG = '#0F172A'
const SSH_ICON_SRC = '/sandbox-providers/ssh.svg'

const ProviderIcon = ({
  providerType,
  size = 'md',
  withBorder = false,
}: ProviderIconProps) => {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'
  const sshIconClass = size === 'sm' ? 'h-[5px] w-auto max-w-[70%]' : 'h-[6px] w-auto max-w-[70%]'

  if (providerType === 'docker') {
    const inner = (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center',
          withBorder ? '' : 'rounded-[10px]',
        )}
        style={{ backgroundColor: DOCKER_BRAND_BLUE }}
      >
        <DockerMarkWhite className="h-6 w-6" />
      </div>
    )
    if (withBorder) {
      return (
        <div
          className={cn(
            'shrink-0 overflow-hidden rounded border-[0.5px] border-divider-subtle',
            sizeClass,
          )}
        >
          {inner}
        </div>
      )
    }
    return inner
  }

  if (providerType === 'e2b') {
    const inner = (
      <E2B
        className={cn('h-full w-full', withBorder ? '' : 'rounded-[10px]')}
      />
    )
    if (withBorder) {
      return (
        <div
          className={cn(
            'shrink-0 overflow-hidden rounded border-[0.5px] border-divider-subtle',
            sizeClass,
          )}
        >
          {inner}
        </div>
      )
    }
    return inner
  }

  if (providerType === 'local') {
    if (withBorder) {
      return (
        <div
          className={cn(
            'shrink-0 overflow-hidden rounded border-[0.5px] border-divider-subtle',
            sizeClass,
          )}
        >
          <SandboxLocal className="h-full w-full" />
        </div>
      )
    }
    return <SandboxLocal className="h-full w-full" />
  }

  if (providerType === 'ssh') {
    const inner = (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center',
          withBorder ? '' : 'rounded-[10px]',
        )}
        style={{ backgroundColor: SSH_CONSOLE_BG }}
      >
        <img src={SSH_ICON_SRC} alt="ssh icon" className={sshIconClass} />
      </div>
    )
    if (withBorder) {
      return (
        <div
          className={cn(
            'shrink-0 overflow-hidden rounded border-[0.5px] border-divider-subtle',
            sizeClass,
          )}
        >
          {inner}
        </div>
      )
    }
    return inner
  }

  const iconSrc = PROVIDER_ICONS[providerType] || PROVIDER_ICONS.e2b
  if (withBorder) {
    return (
      <div
        className={cn(
          'shrink-0 text-clip rounded border-[0.5px] border-divider-subtle',
          sizeClass,
        )}
      >
        <img
          src={iconSrc}
          alt={`${providerType} icon`}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return (
    <img src={iconSrc} alt={`${providerType} icon`} className={sizeClass} />
  )
}

export default ProviderIcon
