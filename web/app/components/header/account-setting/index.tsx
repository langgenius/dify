'use client'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import AccountPage from './account-page'
import MembersPage from './members-page'
import IntegrationsPage from './Integrations-page'
import LanguagePage from './language-page'
import PluginPage from './plugin-page'
import DataSourcePage from './data-source-page'
import ModelPage from './model-page'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import { Database03, PuzzlePiece01 } from '@/app/components/base/icons/src/vender/line/development'
import { Database03 as Database03Solid, PuzzlePiece01 as PuzzlePiece01Solid } from '@/app/components/base/icons/src/vender/solid/development'
import { User01, Users01 } from '@/app/components/base/icons/src/vender/line/users'
import { User01 as User01Solid, Users01 as Users01Solid } from '@/app/components/base/icons/src/vender/solid/users'
import { Globe01 } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'
import { AtSign, XClose } from '@/app/components/base/icons/src/vender/line/general'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'

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
      key: 'workspace-group',
      name: t('common.settings.workplaceGroup'),
      items: [
        {
          key: 'members',
          name: t('common.settings.members'),
          icon: <Users01 className={iconClassName} />,
          activeIcon: <Users01Solid className={iconClassName} />,
        },
        {
          key: 'provider',
          name: t('common.settings.provider'),
          icon: <CubeOutline className={iconClassName} />,
          activeIcon: <CubeOutline className={iconClassName} />,
        },
        {
          key: 'data-source',
          name: t('common.settings.dataSource'),
          icon: <Database03 className={iconClassName} />,
          activeIcon: <Database03Solid className={iconClassName} />,
        },
        {
          key: 'plugin',
          name: t('common.settings.plugin'),
          icon: <PuzzlePiece01 className={iconClassName} />,
          activeIcon: <PuzzlePiece01Solid className={iconClassName} />,
        },
      ],
    },
    {
      key: 'account-group',
      name: t('common.settings.accountGroup'),
      items: [
        {
          key: 'account',
          name: t('common.settings.account'),
          icon: <User01 className={iconClassName} />,
          activeIcon: <User01Solid className={iconClassName} />,
        },
        {
          key: 'integrations',
          name: t('common.settings.integrations'),
          icon: <AtSign className={iconClassName} />,
          activeIcon: <AtSign className={iconClassName} />,
        },
        {
          key: 'language',
          name: t('common.settings.language'),
          icon: <Globe01 className={iconClassName} />,
          activeIcon: <Globe01 className={iconClassName} />,
        },
      ],
    },
  ]
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const scrollHandle = (e: Event) => {
    if ((e.target as HTMLDivElement).scrollTop > 0)
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
      wrapperClassName='!z-20 pt-[60px]'
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
        <div ref={scrollRef} className='relative w-[824px] h-[720px] pb-4 overflow-y-auto'>
          <div className={cn('sticky top-0 px-6 py-4 flex items-center justify-between h-14 mb-4 bg-white text-base font-medium text-gray-900 z-20', scrolled && scrolledClassName)}>
            {[...menuItems[0].items, ...menuItems[1].items].find(item => item.key === activeMenu)?.name}
            <div className='flex items-center justify-center -mr-4 w-6 h-6 cursor-pointer' onClick={onCancel}>
              <XClose className='w-4 h-4 text-gray-500' />
            </div>
          </div>
          <div className='px-8 pt-2'>
            {activeMenu === 'account' && <AccountPage />}
            {activeMenu === 'members' && <MembersPage />}
            {activeMenu === 'integrations' && <IntegrationsPage />}
            {activeMenu === 'language' && <LanguagePage />}
            {activeMenu === 'provider' && <ModelPage />}
            {activeMenu === 'data-source' && <DataSourcePage />}
            {activeMenu === 'plugin' && <PluginPage />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
