import type { ComponentProps } from 'react'
import Debug from '@/app/components/app/configuration/debug'

type DebugProps = ComponentProps<typeof Debug>

type ConfigurationDebugPanelProps = Omit<DebugProps, 'onSetting'> & {
  onOpenModelProvider: () => void
}

const ConfigurationDebugPanel = ({
  onOpenModelProvider,
  ...props
}: ConfigurationDebugPanelProps) => {
  return (
    <Debug
      {...props}
      onSetting={onOpenModelProvider}
    />
  )
}

export default ConfigurationDebugPanel
