'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Transition } from '@headlessui/react'
import Avatar from '@/app/components/base/avatar'
import { logout } from '@/service/common'
import { useAppContext } from '@/context/app-context'
import { LogOut01 } from '@/app/components/base/icons/src/vender/line/general'

export type IAppSelector = {
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
              <Menu.Button
                className={`
                    inline-flex items-center
                    rounded-[20px] p-1x text-sm
                    text-text-primary
                    mobile:px-1
                    ${open && 'bg-components-panel-bg-blur'}
                  `}
              >
                <Avatar name={userProfile.name} size={32} />
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
                    absolute -right-2 -top-1 w-60 max-w-80
                    divide-y divide-divider-subtle origin-top-right rounded-lg bg-components-panel-bg-blur
                    shadow-lg
                  "
              >
                <Menu.Item>
                  <div className='p-1'>
                    <div className='flex flex-nowrap items-center px-3 py-2'>
                      <div className='grow'>
                        <div className='system-md-medium text-text-primary break-all'>{userProfile.name}</div>
                        <div className='system-xs-regular text-text-tertiary break-all'>{userProfile.email}</div>
                      </div>
                      <Avatar name={userProfile.name} size={32} />
                    </div>
                  </div>
                </Menu.Item>
                <Menu.Item>
                  <div className='p-1' onClick={() => handleLogout()}>
                    <div
                      className='flex items-center justify-start h-9 px-3 rounded-lg cursor-pointer group hover:bg-state-base-hover'
                    >
                      <LogOut01 className='w-4 h-4 text-text-tertiary flex mr-1' />
                      <div className='font-normal text-[14px] text-text-secondary'>{t('common.userProfile.logout')}</div>
                    </div>
                  </div>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
