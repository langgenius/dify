'use client'
import type { FC } from 'react'
import type { AutoUpdateConfig } from './auto-update-setting/types'
import type { Permissions, ReferenceSetting } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from '#i18n'
import { PermissionType } from '@/app/components/plugins/types'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import AutoUpdateSetting from './auto-update-setting'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from './auto-update-setting/types'
import Label from './label'

const i18nPrefix = 'privilege'
const autoUpdateDefaultValue: AutoUpdateConfig = {
  strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
  upgrade_time_of_day: 36000,
  upgrade_mode: AUTO_UPDATE_MODE.update_all,
  exclude_plugins: [],
  include_plugins: [],
}

type Props = Readonly<{
  payload: ReferenceSetting
  canSetPermissions?: boolean
  canSetAutoUpdate?: boolean
  onHide: () => void
  onSave: (payload: ReferenceSetting) => void
}>

const PluginSettingModal: FC<Props> = ({
  payload,
  canSetPermissions = false,
  canSetAutoUpdate = false,
  onHide,
  onSave,
}) => {
  const { t } = useTranslation()
  const { auto_upgrade: autoUpdateConfig, permission: privilege } = payload || {}
  const [tempPrivilege, setTempPrivilege] = useState<Permissions>(privilege)
  const [tempAutoUpdateConfig, setTempAutoUpdateConfig] = useState<AutoUpdateConfig>(autoUpdateConfig || autoUpdateDefaultValue)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isPermissionDisabledByRBAC = systemFeatures.rbac_enabled
  const permissionDisabledTip = t(`${i18nPrefix}.configurePermissionsInSettings`, { ns: 'plugin' })
  const handlePrivilegeChange = useCallback((key: string) => {
    return (value: PermissionType) => {
      if (isPermissionDisabledByRBAC)
        return
      setTempPrivilege({
        ...tempPrivilege,
        [key]: value,
      })
    }
  }, [isPermissionDisabledByRBAC, tempPrivilege])

  const handleSave = useCallback(async () => {
    await onSave({
      permission: canSetPermissions ? tempPrivilege : (privilege || tempPrivilege),
      auto_upgrade: canSetAutoUpdate ? tempAutoUpdateConfig : (autoUpdateConfig || tempAutoUpdateConfig),
    })
    onHide()
  }, [autoUpdateConfig, canSetAutoUpdate, canSetPermissions, onHide, onSave, privilege, tempAutoUpdateConfig, tempPrivilege])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className="w-155 max-w-155 overflow-hidden! border-none p-0! text-left align-middle">
        <DialogCloseButton />

        <div className="shadows-shadow-xl flex w-full flex-col items-start rounded-2xl border border-components-panel-border bg-components-panel-bg">
          <div className="flex items-start gap-2 self-stretch pt-6 pr-14 pb-3 pl-6">
            <span className="self-stretch title-2xl-semi-bold text-text-primary">{t(`${i18nPrefix}.title`, { ns: 'plugin' })}</span>
          </div>
          {canSetPermissions && (
            <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
              {[
                { title: t(`${i18nPrefix}.whoCanInstall`, { ns: 'plugin' }), key: 'install_permission', value: tempPrivilege?.install_permission || PermissionType.noOne },
                { title: t(`${i18nPrefix}.whoCanDebug`, { ns: 'plugin' }), key: 'debug_permission', value: tempPrivilege?.debug_permission || PermissionType.noOne },
              ].map(({ title, key, value }) => (
                <div key={key} className="flex flex-col items-start gap-1 self-stretch">
                  <Label
                    label={title}
                    tooltip={isPermissionDisabledByRBAC ? permissionDisabledTip : undefined}
                  />
                  <div className="flex w-full items-start justify-between gap-2">
                    {[PermissionType.everyone, PermissionType.admin, PermissionType.noOne].map(option => (
                      <OptionCard
                        key={option}
                        title={t(`${i18nPrefix}.${option}`, { ns: 'plugin' })}
                        onSelect={() => handlePrivilegeChange(key)(option)}
                        selected={value === option}
                        disabled={isPermissionDisabledByRBAC}
                        className="flex-1"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {
            systemFeatures.enable_marketplace && canSetAutoUpdate && (
              <AutoUpdateSetting payload={tempAutoUpdateConfig} onChange={setTempAutoUpdateConfig} />
            )
          }
          <div className="flex h-19 items-center justify-end gap-2 self-stretch p-6 pt-5">
            <Button
              className="min-w-18"
              onClick={onHide}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              className="min-w-18"
              variant="primary"
              onClick={handleSave}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(PluginSettingModal)
