'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import { RiAccountCircleLine, RiArrowDownSLine, RiArrowRightUpLine, RiBookOpenLine, RiGithubLine, RiInformation2Line, RiLogoutBoxRLine, RiMap2Line, RiSettings3Line, RiStarLine } from '@remixicon/react'
import Link from 'next/link'
import { Menu, Transition } from '@headlessui/react'
import Indicator from '../indicator'
import AccountAbout from '../account-about'
import GithubStar from '../github-star'
import Support from './support'
import Compliance from './compliance'
import classNames from '@/utils/classnames'
import I18n from '@/context/i18n'
import Avatar from '@/app/components/base/avatar'
import { logout } from '@/service/common'
import AppContext, { useAppContext } from '@/context/app-context'
import { useModalContext } from '@/context/modal-context'
import { LanguagesSupported } from '@/i18n/language'
import { LicenseStatus } from '@/types/feature'
import { IS_CLOUD_EDITION } from '@/config'

export type IAppSelector = {
  isMobile: boolean
}

export default function AppSelector({ isMobile }: IAppSelector) {
  const itemClassName = `
    flex items-center w-full h-9 pl-3 pr-2 text-text-secondary system-md-regular
    rounded-lg hover:bg-state-base-hover cursor-pointer gap-1
  `
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const systemFeatures = useContextSelector(AppContext, v => v.systemFeatures)

  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { userProfile, langeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const { setShowAccountSettingModal } = useModalContext()

  const handleLogout = async () => {
    await logout({
      url: '/logout',
      params: {},
    })

    localStorage.removeItem('setup_status')
    localStorage.removeItem('console_token')
    localStorage.removeItem('refresh_token')

    router.push('/signin')
  }

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        {
          ({ open }) => (
            <>
              <Menu.Button
                className={`
                    inline-flex items-center
                    rounded-[20px] py-1 pr-2.5 pl-1 text-sm
                  text-text-secondary hover:bg-state-base-hover
                    mobile:px-1
                    ${open && 'bg-state-base-hover'}
                  `}
              >
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='sm:mr-2 mr-0' size={32} />
                {!isMobile && <>
                  {userProfile.name}
                  <RiArrowDownSLine className="w-3 h-3 ml-1 text-text-tertiary" />
                </>}
              </Menu.Button>
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
                    divide-y divide-divider-subtle origin-top-right rounded-lg bg-components-panel-bg-blur
                    shadow-lg focus:outline-none
                  "
                >
                  <Menu.Item disabled>
                    <div className='flex flex-nowrap items-center pl-3 pr-2 py-[13px]'>
                      <div className='grow'>
                        <div className='system-md-medium text-text-primary break-all'>{userProfile.name}</div>
                        <div className='system-xs-regular text-text-tertiary break-all'>{userProfile.email}</div>
                      </div>
                      <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={36} className='mr-3' />
                    </div>
                  </Menu.Item>
                  <div className="px-1 py-1">
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group',
                          active && 'bg-state-base-hover',
                        )}
                        href='/account'
                        target='_self' rel='noopener noreferrer'>
                        <RiAccountCircleLine className='size-4 flex-shrink-0 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.account.account')}</div>
                        <RiArrowRightUpLine className='size-[14px] flex-shrink-0 text-text-tertiary' />
                      </Link>}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => <div className={classNames(itemClassName,
                        active && 'bg-state-base-hover',
                      )} onClick={() => setShowAccountSettingModal({ payload: 'members' })}>
                        <RiSettings3Line className='size-4 flex-shrink-0 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.settings')}</div>
                      </div>}
                    </Menu.Item>
                  </div>
                  <div className='p-1'>
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href={
                          locale !== LanguagesSupported[1] ? 'https://docs.dify.ai/' : `https://docs.dify.ai/v/${locale.toLowerCase()}/`
                        }
                        target='_blank' rel='noopener noreferrer'>
                        <RiBookOpenLine className='flex-shrink-0 size-4 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.helpCenter')}</div>
                        <RiArrowRightUpLine className='flex-shrink-0 size-[14px] text-text-tertiary' />
                      </Link>}
                    </Menu.Item>
                    <Support />
                    {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
                  </div>
                  <div className='p-1'>
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='https://roadmap.dify.ai'
                        target='_blank' rel='noopener noreferrer'>
                        <RiMap2Line className='flex-shrink-0 size-4 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.roadmap')}</div>
                        <RiArrowRightUpLine className='flex-shrink-0 size-[14px] text-text-tertiary' />
                      </Link>}
                    </Menu.Item>
                    {systemFeatures.license.status === LicenseStatus.NONE && <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='https://github.com/langgenius/dify/stargazers'
                        target='_blank' rel='noopener noreferrer'>
                        <RiGithubLine className='flex-shrink-0 size-4 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.github')}</div>
                        <div className='flex items-center gap-0.5 px-[5px] py-[3px] border border-divider-deep rounded-[5px] bg-components-badge-bg-dimm'>
                          <RiStarLine className='flex-shrink-0 size-3 text-text-tertiary' />
                          <GithubStar className='system-2xs-medium-uppercase text-text-tertiary' />
                        </div>
                      </Link>}
                    </Menu.Item>}
                    {
                      document?.body?.getAttribute('data-public-site-about') !== 'hide' && (
                        <Menu.Item>
                          {({ active }) => <div className={classNames(itemClassName, 'justify-between',
                            active && 'bg-state-base-hover',
                          )} onClick={() => setAboutVisible(true)}>
                            <RiInformation2Line className='flex-shrink-0 size-4 text-text-tertiary' />
                            <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.about')}</div>
                            <div className='flex-shrink-0 flex items-center'>
                              <div className='mr-2 system-xs-regular text-text-tertiary'>{langeniusVersionInfo.current_version}</div>
                              <Indicator color={langeniusVersionInfo.current_version === langeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                            </div>
                          </div>}
                        </Menu.Item>
                      )
                    }
                  </div>
                  <Menu.Item>
                    {({ active }) => <div className='p-1' onClick={() => handleLogout()}>
                      <div
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                      >
                        <RiLogoutBoxRLine className='flex-shrink-0 size-4 text-text-tertiary' />
                        <div className='flex-grow system-md-regular text-text-secondary px-1'>{t('common.userProfile.logout')}</div>
                      </div>
                    </div>}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </>
          )
        }
      </Menu>
      {
        aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langeniusVersionInfo={langeniusVersionInfo} />
      }
    </div >
  )
}
