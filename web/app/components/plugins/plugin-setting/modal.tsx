'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import Button from '@/app/components/base/button'

enum PluginManagementOption {
  Everyone = 'Everyone',
  Admins = 'Admins',
  NoOne = 'No one',
}

type Props = {
  show: boolean
  onHide: () => void
}

const PluginSettingModal: FC<Props> = ({
  show,
  onHide,
}) => {
  const { t } = useTranslation()
  const [manageOption, setManageOption] = useState<PluginManagementOption>(PluginManagementOption.Everyone)
  const [debugOption, setDebugOption] = useState<PluginManagementOption>(PluginManagementOption.Everyone)

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      closable
      className='!p-0 w-[420px]'
    >
      <div className='flex flex-col items-start w-[420px] rounded-2xl border border-components-panel-border bg-components-panel-bg shadows-shadow-xl'>
        <div className='flex pt-6 pb-3 pl-6 pr-14 items-start gap-2 self-stretch'>
          <span className='self-stretch text-text-primary title-2xl-semi-bold'>Plugin Preferences</span>
        </div>
        <div className='flex px-6 py-3 flex-col justify-center items-start gap-4 self-stretch'>
          {[
            { title: 'Who can install and manage plugins?', key: 'manage', value: manageOption, setValue: setManageOption },
            { title: 'Who can debug plugins?', key: 'debug', value: debugOption, setValue: setDebugOption },
          ].map(({ title, key, value, setValue }) => (
            <div key={key} className='flex flex-col items-start gap-1 self-stretch'>
              <div className='flex m-h-6 items-center gap-0.5'>
                <span className='text-text-secondary system-sm-semibold'>{title}</span>
              </div>
              <div className='flex items-start gap-2 justify-between w-full'>
                {Object.values(PluginManagementOption).map(option => (
                  <OptionCard
                    key={option}
                    title={option}
                    onSelect={() => setValue(option)}
                    selected={value === option}
                    className="flex-1"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className='flex h-[76px] p-6 pt-5 justify-end items-center gap-2 self-stretch'>
          <Button
            className='min-w-[72px]'
            onClick={onHide}
          >
            Cancel
          </Button>
          <Button
            className='min-w-[72px]'
            variant={'primary'}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(PluginSettingModal)
