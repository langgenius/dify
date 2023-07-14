'use client'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { AtSymbolIcon, CubeTransparentIcon, GlobeAltIcon, UserIcon, UsersIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { GlobeAltIcon as GlobalAltIconSolid, UserIcon as UserIconSolid, UsersIcon as UsersIconSolid } from '@heroicons/react/24/solid'
import AccountPage from './account-page'
import MembersPage from './members-page'
import IntegrationsPage from './Integrations-page'
import LanguagePage from './language-page'
import ProviderPage from './provider-page'
import DataSourcePage from './data-source-page'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import { Database03 } from '@/app/components/base/icons/src/vender/line/development'
import { Database03 as Database03Solid } from '@/app/components/base/icons/src/vender/solid/development'

const iconClassName = `
  w-4 h-4 ml-3 mr-2
`

const scrolledClassName = `
  border-b shadow-xs bg-white/[.98]
`

type IAccountSettingProps = {
  onCancel: () => void
  activeTab?: string
}
export default function AccountSetting({
  onCancel,
  activeTab = 'account',
}: IAccountSettingProps) {
  const [activeMenu, setActiveMenu] = useState(activeTab)
  const { t } = useTranslation()
  const menuItems = [
    {
      key: 'account-group',
      name: t('common.settings.accountGroup'),
      items: [
        {
          key: 'account',
          name: t('common.settings.account'),
          icon: <UserIcon className={iconClassName} />,
          activeIcon: <UserIconSolid className={iconClassName} />,
        },
        {
          key: 'integrations',
          name: t('common.settings.integrations'),
          icon: <AtSymbolIcon className={iconClassName} />,
          activeIcon: <AtSymbolIcon className={iconClassName} />,
        },
        {
          key: 'language',
          name: t('common.settings.language'),
          icon: <GlobeAltIcon className={iconClassName} />,
          activeIcon: <GlobalAltIconSolid className={iconClassName} />,
        },
      ],
    },
    {
      key: 'workspace-group',
      name: t('common.settings.workplaceGroup'),
      items: [
        {
          key: 'members',
          name: t('common.settings.members'),
          icon: <UsersIcon className={iconClassName} />,
          activeIcon: <UsersIconSolid className={iconClassName} />,
        },
        {
          key: 'provider',
          name: t('common.settings.provider'),
          icon: <CubeTransparentIcon className={iconClassName} />,
          activeIcon: <CubeTransparentIcon className={iconClassName} />,
        },
        {
          key: 'data-source',
          name: t('common.settings.dataSource'),
          icon: <Database03 className={iconClassName} />,
          activeIcon: <Database03Solid className={iconClassName} />,
        },
      ],
    },
  ]
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const scrollHandle = (e: any) => {
    if (e.target.scrollTop > 0)
      setScrolled(true)

    else
      setScrolled(false)
  }
  useEffect(() => {
    const targetElement = scrollRef.current
    targetElement?.addEventListener('scroll', scrollHandle)
    return () => {
      targetElement?.removeEventListener('scroll', scrollHandle)
    }
  }, [])

  return (
    <Modal
      isShow
      onClose={() => { }}
      className={s.modal}
      wrapperClassName='pt-[60px]'
    >
      <div className='flex'>
        <div className='w-[200px] p-4 border border-gray-100'>
          <div className='mb-8 ml-2 text-base font-medium leading-6 text-gray-900'>{t('common.userProfile.settings')}</div>
          <div>
            {
              menuItems.map(menuItem => (
                <div key={menuItem.key} className='mb-4'>
                  <div className='px-2 mb-[6px] text-xs font-medium text-gray-500'>{menuItem.name}</div>
                  <div>
                    {
                      menuItem.items.map(item => (
                        <div
                          key={item.key}
                          className={`
                            flex items-center h-[37px] mb-[2px] text-sm cursor-pointer rounded-lg
                            ${activeMenu === item.key ? 'font-semibold text-primary-600 bg-primary-50' : 'font-light text-gray-700'}
                          `}
                          onClick={() => setActiveMenu(item.key)}
                        >
                          {activeMenu === item.key ? item.activeIcon : item.icon}{item.name}
                        </div>
                      ))
                    }
                  </div>
                </div>
              ))
            }
          </div>
        </div>
        <div ref={scrollRef} className='relative w-[520px] h-[580px] pb-4 overflow-y-auto'>
          <div className={cn('sticky top-0 px-6 py-4 flex items-center justify-between h-14 mb-4 bg-white text-base font-medium text-gray-900', scrolled && scrolledClassName)}>
            {[...menuItems[0].items, ...menuItems[1].items].find(item => item.key === activeMenu)?.name}
            <XMarkIcon className='w-4 h-4 cursor-pointer' onClick={onCancel} />
          </div>
          <div className='px-6'>
            {activeMenu === 'account' && <AccountPage />}
            {activeMenu === 'members' && <MembersPage />}
            {activeMenu === 'integrations' && <IntegrationsPage />}
            {activeMenu === 'language' && <LanguagePage />}
            {activeMenu === 'provider' && <ProviderPage />}
            {activeMenu === 'data-source' && <DataSourcePage />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
