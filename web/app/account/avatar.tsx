'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import Avatar from '@/app/components/base/avatar'
import { logout } from '@/service/common'
import { useAppContext } from '@/context/app-context'
import { LogOut01 } from '@/app/components/base/icons/src/vender/line/general'

export interface IAppSelector {
  isMobile: boolean
}

export default function AppSelector() {
  const router = useRouter()
  const { t } = useTranslation()
  const { userProfile } = useAppContext()

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
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <div>
              <MenuButton
                className={`
                    p-1x text-text-primary
                    mobile:px-1 inline-flex items-center
                    rounded-[20px]
                    text-sm
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
                    divide-divider-subtle bg-components-panel-bg-blur absolute -right-2 -top-1
                    w-60 max-w-80 origin-top-right divide-y rounded-lg
                    shadow-lg
                  "
              >
                <MenuItem>
                  <div className='p-1'>
                    <div className='flex flex-nowrap items-center px-3 py-2'>
                      <div className='grow'>
                        <div className='system-md-medium text-text-primary break-all'>{userProfile.name}</div>
                        <div className='system-xs-regular text-text-tertiary break-all'>{userProfile.email}</div>
                      </div>
                      <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={32} />
                    </div>
                  </div>
                </MenuItem>
                <MenuItem>
                  <div className='p-1' onClick={() => handleLogout()}>
                    <div
                      className='hover:bg-state-base-hover group flex h-9 cursor-pointer items-center justify-start rounded-lg px-3'
                    >
                      <LogOut01 className='text-text-tertiary mr-1 flex h-4 w-4' />
                      <div className='text-text-secondary text-[14px] font-normal'>{t('common.userProfile.logout')}</div>
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
