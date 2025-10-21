'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import Button from '@/app/components/base/button'
import type { Permissions, ReferenceSetting } from '@/app/components/plugins/types'
import { PermissionType } from '@/app/components/plugins/types'
import type { AutoUpdateConfig } from './auto-update-setting/types'
import AutoUpdateSetting from './auto-update-setting'
import { defaultValue as autoUpdateDefaultValue } from './auto-update-setting/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import Label from './label'

const i18nPrefix = 'plugin.privilege'
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
      className='w-[620px] max-w-[620px] !p-0'
    >
      <div className='shadows-shadow-xl flex w-full flex-col items-start rounded-2xl border border-components-panel-border bg-components-panel-bg'>
        <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
          <span className='title-2xl-semi-bold self-stretch text-text-primary'>{t(`${i18nPrefix}.title`)}</span>
        </div>
        <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
          {[
            { title: t(`${i18nPrefix}.whoCanInstall`), key: 'install_permission', value: tempPrivilege?.install_permission || PermissionType.noOne },
            { title: t(`${i18nPrefix}.whoCanDebug`), key: 'debug_permission', value: tempPrivilege?.debug_permission || PermissionType.noOne },
          ].map(({ title, key, value }) => (
            <div key={key} className='flex flex-col items-start gap-1 self-stretch'>
              <Label label={title} />
              <div className='flex w-full items-start justify-between gap-2'>
                {[PermissionType.everyone, PermissionType.admin, PermissionType.noOne].map(option => (
                  <OptionCard
                    key={option}
                    title={t(`${i18nPrefix}.${option}`)}
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
        <div className='flex h-[76px] items-center justify-end gap-2 self-stretch p-6 pt-5'>
          <Button
            className='min-w-[72px]'
            onClick={onHide}
          >
            {t('common.operation.cancel')}
          </Button>
          <Button
            className='min-w-[72px]'
            variant={'primary'}
            onClick={handleSave}
          >
            {t('common.operation.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(PluginSettingModal)
