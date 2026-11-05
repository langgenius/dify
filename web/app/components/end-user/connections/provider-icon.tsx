import type { ConnectionProvider } from './model'
import AppIcon from '@/app/components/base/app-icon'
import useTheme from '@/hooks/use-theme'

type Props = {
  provider: ConnectionProvider
  size?: 'small' | 'medium' | 'large'
}

export default function ProviderIcon({ provider, size = 'medium' }: Props) {
  const { theme } = useTheme()
  const icon = theme === 'dark' ? (provider.icon_dark ?? provider.icon) : provider.icon

  return (
    <AppIcon
      icon={icon ? { icon_type: 'link', icon, icon_background: null } : undefined}
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
