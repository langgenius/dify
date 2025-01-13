'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { RiArrowDownSLine, RiLogoutBoxRLine } from '@remixicon/react'
import Link from 'next/link'
import { Menu, Transition } from '@headlessui/react'
import Indicator from '../indicator'
import AccountAbout from '../account-about'
import { mailToSupport } from '../utils/util'
import WorkplaceSelector from './workplace-selector'
import classNames from '@/utils/classnames'
import I18n from '@/context/i18n'
import Avatar from '@/app/components/base/avatar'
import { logout } from '@/service/common'
import { useAppContext } from '@/context/app-context'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { useModalContext } from '@/context/modal-context'
import { LanguagesSupported } from '@/i18n/language'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'

export type IAppSelector = {
  isMobile: boolean
}

export default function AppSelector({ isMobile }: IAppSelector) {
  const itemClassName = `
    flex items-center w-full h-9 px-3 text-text-secondary system-md-regular
    rounded-lg hover:bg-state-base-hover cursor-pointer
  `
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)

  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { userProfile, langeniusVersionInfo } = useAppContext()
  const { setShowAccountSettingModal } = useModalContext()
  const { plan } = useProviderContext()
  const canEmailSupport = plan.type === Plan.professional || plan.type === Plan.team || plan.type === Plan.enterprise

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
                  text-gray-700 hover:bg-gray-200
                    mobile:px-1
                    ${open && 'bg-gray-200'}
                  `}
              >
                <Avatar name={userProfile.name} className='sm:mr-2 mr-0' size={32} />
                {!isMobile && <>
                  {userProfile.name}
                  <RiArrowDownSLine className="w-3 h-3 ml-1 text-gray-700" />
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
                    <div className='flex flex-nowrap items-center px-4 py-[13px]'>
                      <Avatar name={userProfile.name} size={36} className='mr-3' />
                      <div className='grow'>
                        <div className='system-md-medium text-text-primary break-all'>{userProfile.name}</div>
                        <div className='system-xs-regular text-text-tertiary break-all'>{userProfile.email}</div>
                      </div>
                    </div>
                  </Menu.Item>
                  <div className='px-1 py-1'>
                    <div className='mt-2 px-3 text-xs font-medium text-text-tertiary'>{t('common.userProfile.workspace')}</div>
                    <WorkplaceSelector />
                  </div>
                  <div className="px-1 py-1">
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='/account'
                        target='_self' rel='noopener noreferrer'>
                        <div>{t('common.account.account')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </Link>}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => <div className={classNames(itemClassName,
                        active && 'bg-state-base-hover',
                      )} onClick={() => setShowAccountSettingModal({ payload: 'members' })}>
                        <div>{t('common.userProfile.settings')}</div>
                      </div>}
                    </Menu.Item>
                    {canEmailSupport && <Menu.Item>
                      {({ active }) => <a
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href={mailToSupport(userProfile.email, plan.type, langeniusVersionInfo.current_version)}
                        target='_blank' rel='noopener noreferrer'>
                        <div>{t('common.userProfile.emailSupport')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </a>}
                    </Menu.Item>}
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='https://github.com/langgenius/dify/discussions/categories/feedbacks'
                        target='_blank' rel='noopener noreferrer'>
                        <div>{t('common.userProfile.communityFeedback')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </Link>}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='https://discord.gg/5AEfbxcd9k'
                        target='_blank' rel='noopener noreferrer'>
                        <div>{t('common.userProfile.community')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </Link>}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href={
                          locale !== LanguagesSupported[1] ? 'https://docs.dify.ai/' : `https://docs.dify.ai/v/${locale.toLowerCase()}/`
                        }
                        target='_blank' rel='noopener noreferrer'>
                        <div>{t('common.userProfile.helpCenter')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </Link>}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => <Link
                        className={classNames(itemClassName, 'group justify-between',
                          active && 'bg-state-base-hover',
                        )}
                        href='https://roadmap.dify.ai'
                        target='_blank' rel='noopener noreferrer'>
                        <div>{t('common.userProfile.roadmap')}</div>
                        <ArrowUpRight className='hidden w-[14px] h-[14px] text-text-tertiary group-hover:flex' />
                      </Link>}
                    </Menu.Item>
                    {
                      document?.body?.getAttribute('data-public-site-about') !== 'hide' && (
                        <Menu.Item>
                          {({ active }) => <div className={classNames(itemClassName, 'justify-between',
                            active && 'bg-state-base-hover',
                          )} onClick={() => setAboutVisible(true)}>
                            <div>{t('common.userProfile.about')}</div>
                            <div className='flex items-center'>
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
                        className={
                          classNames('flex items-center justify-between h-9 px-3 rounded-lg cursor-pointer group hover:bg-state-base-hover',
                            active && 'bg-state-base-hover')}
                      >
                        <div className='system-md-regular text-text-secondary'>{t('common.userProfile.logout')}</div>
                        <RiLogoutBoxRLine className='hidden w-4 h-4 text-text-tertiary group-hover:flex' />
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
