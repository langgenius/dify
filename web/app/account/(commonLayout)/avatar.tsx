'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { useRouter } from 'next/navigation'
import {
  RiGraduationCapFill,
} from '@remixicon/react'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { LogOut01 } from '@/app/components/base/icons/src/vender/line/general'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useLogout } from '@/service/use-common'

export type IAppSelector = {
  isMobile: boolean
}

export default function AppSelector() {
  const router = useRouter()
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const { isEducationAccount } = useProviderContext()

  const { mutateAsync: logout } = useLogout()
  const handleLogout = async () => {
    await logout()

    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    router.push('/signin')
  }

  return (
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <div>
              <MenuButton
                className={`
                    p-1x inline-flex
                    items-center rounded-[20px] text-sm
                    text-text-primary
                    mobile:px-1
                    ${open && 'bg-components-panel-bg-blur'}
                  `}
              >
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={32} />
              </MenuButton>
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
              <MenuItems
                className="
                    absolute -right-2 -top-1 w-60 max-w-80
                    origin-top-right divide-y divide-divider-subtle rounded-lg bg-components-panel-bg-blur
                    shadow-lg
                  "
              >
                <MenuItem>
                  <div className='p-1'>
                    <div className='flex flex-nowrap items-center px-3 py-2'>
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
                      <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={32} />
                    </div>
                  </div>
                </MenuItem>
                <MenuItem>
                  <div className='p-1' onClick={() => handleLogout()}>
                    <div
                      className='group flex h-9 cursor-pointer items-center justify-start rounded-lg px-3 hover:bg-state-base-hover'
                    >
                      <LogOut01 className='mr-1 flex h-4 w-4 text-text-tertiary' />
                      <div className='text-[14px] font-normal text-text-secondary'>{t('common.userProfile.logout')}</div>
                    </div>
                  </div>
                </MenuItem>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
