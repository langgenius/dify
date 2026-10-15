import type { ConnectionProvider } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  provider: ConnectionProvider
  size?: 'medium' | 'large'
}

export default function ProviderIcon({ provider, size = 'medium' }: Props) {
  return (
    <AppIcon
      size={size === 'large' ? 'xl' : 'large'}
      background="var(--color-background-default-dodge)"
      className="rounded-lg"
      decorative
      innerIcon={<span className={cn('size-6 text-text-secondary', provider.iconClassName)} />}
    />
  )
}
