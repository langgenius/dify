'use client'
import type { FC } from 'react'
import type { AutoUpdateConfig } from './auto-update-setting/types'
import type { Permissions, ReferenceSetting } from '@/app/components/plugins/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { PermissionType } from '@/app/components/plugins/types'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { useGlobalPublicStore } from '@/context/global-public-context'
import AutoUpdateSetting from './auto-update-setting'
import { defaultValue as autoUpdateDefaultValue } from './auto-update-setting/config'
import Label from './label'

const i18nPrefix = 'privilege'
type Props = {
  payload: ReferenceSetting
  onHide: () => void
  onSave: (payload: ReferenceSetting) => void
}

const PluginSettingModal: FC<Props> = ({
  payload,
  onHide,
  onSave,
}) => {
  const { t } = useTranslation()
  const { auto_upgrade: autoUpdateConfig, permission: privilege } = payload || {}
  const [tempPrivilege, setTempPrivilege] = useState<Permissions>(privilege)
  const [tempAutoUpdateConfig, setTempAutoUpdateConfig] = useState<AutoUpdateConfig>(autoUpdateConfig || autoUpdateDefaultValue)
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)
  const handlePrivilegeChange = useCallback((key: string) => {
    return (value: PermissionType) => {
      setTempPrivilege({
        ...tempPrivilege,
        [key]: value,
      })
    }
  }, [tempPrivilege])

  const handleSave = useCallback(async () => {
    await onSave({
      permission: tempPrivilege,
      auto_upgrade: tempAutoUpdateConfig,
    })
    onHide()
  }, [onHide, onSave, tempAutoUpdateConfig, tempPrivilege])

  return (
    <Modal
      isShow
      onClose={onHide}
      closable
      className="w-[620px] max-w-[620px] !p-0"
    >
      <div className="shadows-shadow-xl flex w-full flex-col items-start rounded-2xl border border-components-panel-border bg-components-panel-bg">
        <div className="flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6">
          <span className="title-2xl-semi-bold self-stretch text-text-primary">{t(`${i18nPrefix}.title`, { ns: 'plugin' })}</span>
        </div>
        <div className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3">
          {[
            { title: t(`${i18nPrefix}.whoCanInstall`, { ns: 'plugin' }), key: 'install_permission', value: tempPrivilege?.install_permission || PermissionType.noOne },
            { title: t(`${i18nPrefix}.whoCanDebug`, { ns: 'plugin' }), key: 'debug_permission', value: tempPrivilege?.debug_permission || PermissionType.noOne },
          ].map(({ title, key, value }) => (
            <div key={key} className="flex flex-col items-start gap-1 self-stretch">
              <Label label={title} />
              <div className="flex w-full items-start justify-between gap-2">
                {[PermissionType.everyone, PermissionType.admin, PermissionType.noOne].map(option => (
                  <OptionCard
                    key={option}
                    title={t(`${i18nPrefix}.${option}`, { ns: 'plugin' })}
                    onSelect={() => handlePrivilegeChange(key)(option)}
                    selected={value === option}
                    className="flex-1"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {
          enable_marketplace && (
            <AutoUpdateSetting payload={tempAutoUpdateConfig} onChange={setTempAutoUpdateConfig} />
          )
        }
        <div className="flex h-[76px] items-center justify-end gap-2 self-stretch p-6 pt-5">
          <Button
            className="min-w-[72px]"
            onClick={onHide}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            className="min-w-[72px]"
            variant="primary"
            onClick={handleSave}
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(PluginSettingModal)
