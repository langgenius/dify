import type { ExternalAgentOverviewPreview } from '../preview'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import { getMonitoringAppId } from './preview'

export function MonitoringAppsFilter({
  apps,
  value,
  onChange,
}: {
  apps: ExternalAgentOverviewPreview['agent']['apps']
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation(['agentRoster'])
  const items = [
    { value: 'all', label: t(($) => $['external.monitoring.allApps']), emoji: '' },
    ...apps.map((app) => ({
      value: getMonitoringAppId(app),
      label: app.name,
      emoji: app.kind === 'workflow' ? '🔄' : '💬',
    })),
  ]

  return (
    <Select<string>
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
    >
      <SelectTrigger aria-label={t(($) => $['external.monitoring.apps'])} className="w-35">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-65">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="gap-1 system-md-regular">
            {item.emoji && (
              <span aria-hidden className="size-4 shrink-0 text-sm">
                {item.emoji}
              </span>
            )}
            <SelectItemText>{item.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
