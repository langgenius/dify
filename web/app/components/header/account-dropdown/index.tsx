'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  RiAccountCircleLine,
  RiArrowRightUpLine,
  RiBookOpenLine,
  RiGithubLine,
  RiGraduationCapFill,
  RiInformation2Line,
  RiLogoutBoxRLine,
  RiMap2Line,
  RiSettings3Line,
  RiStarLine,
  RiTShirt2Line,
} from '@remixicon/react'
import Link from 'next/link'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import Indicator from '../indicator'
import AccountAbout from '../account-about'
import GithubStar from '../github-star'
import Support from './support'
import Compliance from './compliance'
import PremiumBadge from '@/app/components/base/premium-badge'
import Avatar from '@/app/components/base/avatar'
import ThemeSwitcher from '@/app/components/base/theme-switcher'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'
import { IS_CLOUD_EDITION } from '@/config'
import cn from '@/utils/classnames'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useDocLink } from '@/context/i18n'
import { useLogout } from '@/service/use-common'

export default function AppSelector() {
  const itemClassName = `
    flex items-center w-full h-8 pl-3 pr-2 text-text-secondary system-md-regular
    rounded-lg hover:bg-state-base-hover cursor-pointer gap-1
  `
  const router = useRouter()
  const [aboutVisible, setAboutVisible] = useState(false)
  const { systemFeatures } = useGlobalPublicStore()

  const { t } = useTranslation()
  const docLink = useDocLink()
  const { userProfile, langGeniusVersionInfo, isCurrentWorkspaceOwner } = useAppContext()
  const { isEducationAccount } = useProviderContext()
  const { setShowAccountSettingModal } = useModalContext()

  const { mutateAsync: logout } = useLogout()
  const handleLogout = async () => {
    await logout()

    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    // To avoid use other account's education notice info
    localStorage.removeItem('education-reverify-prev-expire-at')
    localStorage.removeItem('education-reverify-has-noticed')
    localStorage.removeItem('education-expired-has-noticed')

    router.push('/signin')
  }

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        {
          ({ open, close }) => (
            <>
              <MenuButton className={cn('inline-flex items-center rounded-[20px] p-0.5 hover:bg-background-default-dodge', open && 'bg-background-default-dodge')}>
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={36} />
              </MenuButton>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <MenuItems
                  className="
                    absolute right-0 mt-1.5 w-60 max-w-80
                    origin-top-right divide-y divide-divider-subtle rounded-xl bg-components-panel-bg-blur shadow-lg
                    backdrop-blur-sm focus:outline-none
                  "
                >
                  <div className="px-1 py-1">
                    <MenuItem disabled>
                      <div className='flex flex-nowrap items-center py-2 pl-3 pr-2'>
                        <div className='grow'>
                          <div className='system-md-medium break-all text-text-primary'>
                            {userProfile.name}
                            {isEducationAccount && (
                              <PremiumBadge size='s' color='blue' className='ml-1 !px-2'>
                                <RiGraduationCapFill className='mr-1 h-3 w-3' />
                                <span className='system-2xs-medium'>EDU</span>
                              </PremiumBadge>
                            )}
                          </div>
                          <div className='system-xs-regular break-all text-text-tertiary'>{userProfile.email}</div>
                        </div>
                        <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={36} />
                      </div>
                    </MenuItem>
                    <MenuItem>
                      <Link
                        className={cn(itemClassName, 'group',
                          'data-[active]:bg-state-base-hover',
                        )}
                        href='/account'
                        target='_self' rel='noopener noreferrer'>
                        <RiAccountCircleLine className='size-4 shrink-0 text-text-tertiary' />
                        <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.account.account')}</div>
                        <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                      </Link>
                    </MenuItem>
                    <MenuItem>
                      <div className={cn(itemClassName,
                        'data-[active]:bg-state-base-hover',
                      )} onClick={() => setShowAccountSettingModal({ payload: 'members' })}>
                        <RiSettings3Line className='size-4 shrink-0 text-text-tertiary' />
                        <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.settings')}</div>
                      </div>
                    </MenuItem>
                  </div>
                  {!systemFeatures.branding.enabled && <>
                    <div className='p-1'>
                      <MenuItem>
                        <Link
                          className={cn(itemClassName, 'group justify-between',
                            'data-[active]:bg-state-base-hover',
                          )}
                          href={docLink('/introduction')}
                          target='_blank' rel='noopener noreferrer'>
                          <RiBookOpenLine className='size-4 shrink-0 text-text-tertiary' />
                          <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.helpCenter')}</div>
                          <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                        </Link>
                      </MenuItem>
                      <Support closeAccountDropdown={close} />
                      {IS_CLOUD_EDITION && isCurrentWorkspaceOwner && <Compliance />}
                    </div>
                    <div className='p-1'>
                      <MenuItem>
                        <Link
                          className={cn(itemClassName, 'group justify-between',
                            'data-[active]:bg-state-base-hover',
                          )}
                          href='https://roadmap.dify.ai'
                          target='_blank' rel='noopener noreferrer'>
                          <RiMap2Line className='size-4 shrink-0 text-text-tertiary' />
                          <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.roadmap')}</div>
                          <RiArrowRightUpLine className='size-[14px] shrink-0 text-text-tertiary' />
                        </Link>
                      </MenuItem>
                      <MenuItem>
                        <Link
                          className={cn(itemClassName, 'group justify-between',
                            'data-[active]:bg-state-base-hover',
                          )}
                          href='https://github.com/langgenius/dify'
                          target='_blank' rel='noopener noreferrer'>
                          <RiGithubLine className='size-4 shrink-0 text-text-tertiary' />
                          <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.github')}</div>
                          <div className='flex items-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]'>
                            <RiStarLine className='size-3 shrink-0 text-text-tertiary' />
                            <GithubStar className='system-2xs-medium-uppercase text-text-tertiary' />
                          </div>
                        </Link>
                      </MenuItem>
                      {
                        document?.body?.getAttribute('data-public-site-about') !== 'hide' && (
                          <MenuItem>
                            <div className={cn(itemClassName, 'justify-between',
                              'data-[active]:bg-state-base-hover',
                            )} onClick={() => setAboutVisible(true)}>
                              <RiInformation2Line className='size-4 shrink-0 text-text-tertiary' />
                              <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.about')}</div>
                              <div className='flex shrink-0 items-center'>
                                <div className='system-xs-regular mr-2 text-text-tertiary'>{langGeniusVersionInfo.current_version}</div>
                                <Indicator color={langGeniusVersionInfo.current_version === langGeniusVersionInfo.latest_version ? 'green' : 'orange'} />
                              </div>
                            </div>
                          </MenuItem>
                        )
                      }
                    </div>
                  </>}
                  <MenuItem disabled>
                    <div className='p-1'>
                      <div className={cn(itemClassName, 'hover:bg-transparent')}>
                        <RiTShirt2Line className='size-4 shrink-0 text-text-tertiary' />
                        <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.theme.theme')}</div>
                        <ThemeSwitcher />
                      </div>
                    </div>
                  </MenuItem>
                  <MenuItem>
                    <div className='p-1' onClick={() => handleLogout()}>
                      <div
                        className={cn(itemClassName, 'group justify-between',
                          'data-[active]:bg-state-base-hover',
                        )}
                      >
                        <RiLogoutBoxRLine className='size-4 shrink-0 text-text-tertiary' />
                        <div className='system-md-regular grow px-1 text-text-secondary'>{t('common.userProfile.logout')}</div>
                      </div>
                    </div>
                  </MenuItem>
                </MenuItems>
              </Transition>
            </>
          )
        }
      </Menu>
      {
        aboutVisible && <AccountAbout onCancel={() => setAboutVisible(false)} langGeniusVersionInfo={langGeniusVersionInfo} />
      }
    </div >
  )
}
