'use client'

import type { Permissions } from '@/app/components/plugins/types'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useTranslation } from 'react-i18next'
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
      label: t('privilege.quickWhoCanInstall', { ns: 'plugin' }),
      value: permission.install_permission || PermissionType.noOne,
    },
    {
      key: 'debug_permission',
      label: t('privilege.quickWhoCanDebug', { ns: 'plugin' }),
      value: permission.debug_permission || PermissionType.noOne,
    },
  ]

  return (
    <div className="w-[249px] overflow-hidden rounded-2xl border-t border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="border-b-[0.5px] border-black/5 py-2">
        <div className="flex flex-col gap-1 px-1 pt-0.5 pb-1">
          <div className="px-3 pt-1 pb-0.5 system-sm-semibold-uppercase text-text-secondary">
            {t('privilege.permissions', { ns: 'plugin' })}
          </div>
          {rows.map(row => (
            <div key={row.key} className="flex flex-col gap-0.5 px-3 py-1">
              <div className="flex min-h-6 items-center system-sm-semibold whitespace-nowrap text-text-secondary">
                {row.label}
              </div>
              <SegmentedControl<PermissionType>
                value={[row.value]}
                onValueChange={(value) => {
                  const nextValue = value[0]
                  if (nextValue)
                    onChange(row.key, nextValue)
                }}
                aria-label={row.label}
                className="w-fit"
              >
                {permissionSettingOptions.map((option) => {
                  const optionLabel = t(`privilege.${option}`, { ns: 'plugin' })

                  return (
                    <SegmentedControlItem
                      key={option}
                      value={option}
                      aria-label={`${row.label}: ${optionLabel}`}
                      className="shrink-0"
                    >
                      <span className="px-0.5 py-0.5">{optionLabel}</span>
                    </SegmentedControlItem>
                  )
                })}
              </SegmentedControl>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
