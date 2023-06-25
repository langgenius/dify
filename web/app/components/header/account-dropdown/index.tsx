'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useState } from 'react'
import { useContext } from 'use-context-selector'
import classNames from 'classnames'
import Link from 'next/link'
import { ArrowRightOnRectangleIcon, ArrowTopRightOnSquareIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { Menu, Transition } from '@headlessui/react'
import Indicator from '../indicator'
import AccountSetting from '../account-setting'
import AccountAbout from '../account-about'
import type { LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import I18n from '@/context/i18n'
import WorkplaceSelector from './workplace-selector'
import Avatar from '@/app/components/base/avatar'

type IAppSelectorProps = {
  userProfile: UserProfileResponse
  onLogout: () => void
  langeniusVersionInfo: LangGeniusVersionResponse
}

export default function AppSelector({ userProfile, onLogout, langeniusVersionInfo }: IAppSelectorProps) {
  const itemClassName = `
    flex items-center w-full h-10 px-3 text-gray-700 text-[14px]
    rounded-lg font-normal hover:bg-gray-100 cursor-pointer
  `
  const [settingVisible, setSettingVisible] = useState(false)
  const [aboutVisible, setAboutVisible] = useState(false)

  const { locale } = useContext(I18n)
  const { t } = useTranslation()

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        <div>
          <Menu.Button
            className="
              inline-flex items-center h-[38px]
              rounded-xl pl-2 pr-2.5 text-[14px] font-normal
              text-gray-800 hover:bg-gray-200
            "
          >
            <Avatar name={userProfile.name} className='mr-2' />
            {userProfile.name}
            <ChevronDownIcon
              className="w-3 h-3 ml-1"
              aria-hidden="true"
            />
          </Menu.Button>
        </div>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items
            className="
              absolute right-0 mt-1.5 w-60 max-w-80
              divide-y divide-gray-100 origin-top-right rounded-lg bg-white
              shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_rgba(0,0,0,0.05)]
            "
          >
            <Menu.Item>
              <div className='flex flex-nowrap items-center px-4 py-[13px]'>
                <Avatar name={userProfile.name} size={36} className='mr-3' />
                <div className='grow'>
                  <div className='leading-5 font-normal text-[14px] text-gray-800 break-all'>{userProfile.name}</div>
                  <div className='leading-[18px] text-xs font-normal text-gray-500 break-all'>{userProfile.email}</div>
                </div>
              </div>
            </Menu.Item>
            <div className='px-1 py-1'>
              <div className='mt-2 px-3 text-xs font-medium text-gray-500'>{t('common.userProfile.workspace')}</div>
              <WorkplaceSelector />
            </div>
            <div className="px-1 py-1">
              <Menu.Item>
                <div className={itemClassName} onClick={() => setSettingVisible(true)}>
                  <div>{t('common.userProfile.settings')}</div>
                </div>
              </Menu.Item>
            </div>
            <Menu.Item>
              <div className='p-1' onClick={() => onLogout()}>
                <div
                  className='flex items-center justify-between h-12 px-3 rounded-lg cursor-pointer group hover:bg-gray-100'
                >
                  <div className='font-normal text-[14px] text-gray-700'>{t('common.userProfile.logout')}</div>
                  <ArrowRightOnRectangleIcon className='hidden w-4 h-4 group-hover:flex' />
                </div>
              </div>
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
      {
        settingVisible && <AccountSetting onCancel={() => setSettingVisible(false)} />
      }
      {
        aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langeniusVersionInfo={langeniusVersionInfo} />
      }
    </div >
  )
}
