'use client'

import type { Permissions } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { useTranslation } from 'react-i18next'
import { PluginSidecarPanel } from '@/app/components/plugins/plugin-page/plugin-sidecar-panel'
import { PermissionType } from '@/app/components/plugins/types'

export type PermissionSettingKey = keyof Permissions

const permissionSettingOptions = [
  PermissionType.everyone,
  PermissionType.admin,
  PermissionType.noOne,
] as const

type PermissionQuickPanelProps = {
  permission: Permissions
  onChange: (key: PermissionSettingKey, value: PermissionType) => void
}

const permissionOptionCardClassName = cn(
  'flex h-8 w-[104px] shrink-0 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg p-2 text-center system-sm-regular text-text-secondary transition-colors',
  'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
  'focus-visible:ring-2 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
  'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:font-medium data-checked:text-text-primary data-checked:shadow-xs data-checked:shadow-shadow-shadow-3',
)

export function PermissionQuickPanel({
  permission,
  onChange,
}: PermissionQuickPanelProps) {
  const { t } = useTranslation()
  const rows: Array<{
    key: PermissionSettingKey
    label: string
    value: PermissionType
  }> = [
    {
      key: 'install_permission',
      label: t($ => $['privilege.quickWhoCanInstall'], { ns: 'plugin' }),
      value: permission.install_permission || PermissionType.noOne,
    },
    {
      key: 'debug_permission',
      label: t($ => $['privilege.quickWhoCanDebug'], { ns: 'plugin' }),
      value: permission.debug_permission || PermissionType.noOne,
    },
  ]

  return (
    <PluginSidecarPanel title={t($ => $['privilege.permissions'], { ns: 'plugin' })}>
      <div className="flex w-full shrink-0 flex-col items-start justify-center gap-3 px-4 pt-2 pb-4">
        {rows.map(row => (
          <div key={row.key} className="flex w-full shrink-0 flex-col items-start gap-1">
            <div className="flex min-h-6 items-center system-sm-medium whitespace-nowrap text-text-secondary">
              {row.label}
            </div>
            <RadioGroup<PermissionType>
              value={row.value}
              onValueChange={(nextValue) => {
                if (nextValue)
                  onChange(row.key, nextValue)
              }}
              aria-label={row.label}
              className="w-full gap-2"
            >
              {permissionSettingOptions.map((option) => {
                const optionLabel = t($ => $[`privilege.${option}`], { ns: 'plugin' })

                return (
                  <RadioItem<PermissionType>
                    key={option}
                    value={option}
                    nativeButton
                    render={<button type="button" className={permissionOptionCardClassName} />}
                    aria-label={`${row.label}: ${optionLabel}`}
                  >
                    <span className="min-w-0 truncate">{optionLabel}</span>
                  </RadioItem>
                )
              })}
            </RadioGroup>
          </div>
        ))}
      </div>
    </PluginSidecarPanel>
  )
}
