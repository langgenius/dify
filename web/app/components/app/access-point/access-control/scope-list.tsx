'use client'

import type { AccessControlDraft } from './draft'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'

const SCOPE_ICONS: Record<Exclude<AccessPoint, 'webApp'>, string> = {
  serviceApi: 'i-custom-vender-knowledge-api-aggregate',
  mcp: 'i-custom-vender-integrations-mcp',
  trigger: 'i-custom-vender-integrations-trigger',
}

type AccessControlScopeListProps = {
  draft: AccessControlDraft
  onDraftChange: (draft: AccessControlDraft) => void
}

export function AccessControlScopeList({ draft, onDraftChange }: AccessControlScopeListProps) {
  const { t } = useTranslation()
  const appInfo = useAppStore((state) => state.appDetail)

  const labels: Record<AccessPoint, string> = {
    webApp: t(($) => $['overview.appInfo.title'], { ns: 'appOverview' }),
    serviceApi: t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' }),
    mcp: t(($) => $['mcp.server.title'], { ns: 'tools' }),
    trigger: t(($) => $['settings.trigger'], { ns: 'common' }),
  }

  return (
    <div className="flex w-full flex-col gap-0.5">
      {ACCESS_POINT_ORDER.map((scope) => {
        const label = labels[scope]

        return (
          <div key={scope} className="flex items-center gap-2 py-2">
            {scope === 'webApp' ? (
              <AppIcon
                size="tiny"
                decorative
                iconType={appInfo?.icon_type}
                icon={appInfo?.icon}
                background={appInfo?.icon_background ?? undefined}
                imageUrl={appInfo?.icon_url}
                className="rounded-sm bg-util-colors-orange-orange-100"
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-sm border-[0.5px] border-divider-regular bg-components-panel-bg">
                <span
                  aria-hidden
                  className={cn(SCOPE_ICONS[scope], 'size-3.5 text-text-tertiary')}
                />
              </span>
            )}
            <span className="min-w-0 flex-1 system-sm-medium text-text-secondary">{label}</span>
            <Switch
              checked={draft.scopes[scope]}
              aria-label={label}
              onCheckedChange={(checked) => {
                onDraftChange({
                  ...draft,
                  scopes: {
                    ...draft.scopes,
                    [scope]: checked,
                  },
                })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
