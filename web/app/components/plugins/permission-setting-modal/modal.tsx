'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import Button from '@/app/components/base/button'
import type { Permissions } from '@/app/components/plugins/types'
import { PermissionType } from '@/app/components/plugins/types'

const i18nPrefix = 'plugin.privilege'
type Props = {
  payload: Permissions
  onHide: () => void
  onSave: (payload: Permissions) => void
}

const PluginSettingModal: FC<Props> = ({
  payload,
  onHide,
  onSave,
}) => {
  const { t } = useTranslation()
  const [tempPrivilege, setTempPrivilege] = useState<Permissions>(payload)
  const handlePrivilegeChange = useCallback((key: string) => {
    return (value: PermissionType) => {
      setTempPrivilege({
        ...tempPrivilege,
        [key]: value,
      })
    }
  }, [tempPrivilege])

  const handleSave = useCallback(async () => {
    await onSave(tempPrivilege)
    onHide()
  }, [onHide, onSave, tempPrivilege])

  return (
    <Modal
      isShow
      onClose={onHide}
      closable
      className='w-[420px] !p-0'
    >
      <div className='border-components-panel-border bg-components-panel-bg shadows-shadow-xl flex w-[420px] flex-col items-start rounded-2xl border'>
        <div className='flex items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6'>
          <span className='text-text-primary title-2xl-semi-bold self-stretch'>{t(`${i18nPrefix}.title`)}</span>
        </div>
        <div className='flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3'>
          {[
            { title: t(`${i18nPrefix}.whoCanInstall`), key: 'install_permission', value: tempPrivilege.install_permission },
            { title: t(`${i18nPrefix}.whoCanDebug`), key: 'debug_permission', value: tempPrivilege.debug_permission },
          ].map(({ title, key, value }) => (
            <div key={key} className='flex flex-col items-start gap-1 self-stretch'>
              <div className='flex h-6 items-center gap-0.5'>
                <span className='text-text-secondary system-sm-semibold'>{title}</span>
              </div>
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
