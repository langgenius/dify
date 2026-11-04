import type { ConnectionProvider } from './model'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  provider: ConnectionProvider
  size?: 'small' | 'medium' | 'large'
}

export default function ProviderIcon({ size = 'medium' }: Props) {
  return (
    <AppIcon
      size={size === 'small' ? 'small' : size === 'large' ? 'xl' : 'large'}
      className="rounded-lg"
      decorative
      fallback={{
        content: <span className="i-ri-plug-line size-6 text-text-secondary" />,
        background: 'var(--color-background-default-dodge)',
      }}
    />
  )
}
