'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useCallback } from 'react'
import cn from 'classnames'
import { Menu, Transition } from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { debounce } from 'lodash-es'
import Indicator from '../../indicator'
import AppIcon from '@/app/components/base/app-icon'
import { useAppContext } from '@/context/app-context'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ChevronDown, ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { FileArrow01, FilePlus01, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

export type NavItem = {
  id: string
  name: string
  link: string
  icon: string
  icon_background: string
}
export type INavSelectorProps = {
  navs: NavItem[]
  curNav?: Omit<NavItem, 'link'>
  createText: string
  onCreate: (state: string) => void
  onLoadmore?: () => void
}

const NavSelector = ({ curNav, navs, createText, onCreate, onLoadmore }: INavSelectorProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { setAppDetail } = useAppStore()

  const handleScroll = useCallback(debounce((e) => {
    if (typeof onLoadmore === 'function') {
      const { clientHeight, scrollHeight, scrollTop } = e.target

      if (clientHeight + scrollTop > scrollHeight - 50)
        onLoadmore()
    }
  }, 50), [])

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        {({ open }) => (
          <>
            <Menu.Button className={cn(
              'group inline-flex items-center w-full h-7 justify-center rounded-[10px] pl-2 pr-2.5 text-[14px] font-semibold text-primary-600 hover:bg-primary-50',
              open && 'bg-primary-50',
            )}>
              <div className='max-w-[180px] truncate' title={curNav?.name}>{curNav?.name}</div>
              <ChevronDown
                className={cn('shrink-0 w-3 h-3 ml-1 opacity-50 group-hover:opacity-100', open && '!opacity-100')}
                aria-hidden="true"
              />
            </Menu.Button>
            <Menu.Items
              className="
                absolute -left-11 right-0 mt-1.5 w-60 max-w-80
                divide-y divide-gray-100 origin-top-right rounded-lg bg-white
                shadow-lg
              "
            >
              <div className="px-1 py-1 overflow-auto" style={{ maxHeight: '50vh' }} onScroll={handleScroll}>
                {
                  navs.map(nav => (
                    <Menu.Item key={nav.id}>
                      <div className='flex items-center w-full px-3 py-[6px] text-gray-700 text-[14px] rounded-lg font-normal hover:bg-gray-100 cursor-pointer truncate' onClick={() => {
                        setAppDetail()
                        router.push(nav.link)
                      }} title={nav.name}>
                        <div className='relative w-6 h-6 mr-2 rounded-md'>
                          <AppIcon size='tiny' icon={nav.icon} background={nav.icon_background}/>
                          <div className='flex justify-center items-center absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 bg-white rounded'>
                            <Indicator />
                          </div>
                        </div>
                        <div className='truncate'>
                          {nav.name}
                        </div>
                      </div>
                    </Menu.Item>
                  ))
                }
              </div>
              {isCurrentWorkspaceManager && (
                <Menu as="div" className="relative w-full h-full">
                  {({ open }) => (
                    <>
                      <Menu.Button className='p-1 w-full'>
                        <div className={cn(
                          'flex items-center gap-2 px-3 py-[6px] rounded-lg cursor-pointer hover:bg-gray-100',
                          open && '!bg-gray-100',
                        )}>
                          <div className='shrink-0 flex justify-center items-center w-6 h-6 bg-gray-50 rounded-[6px] border-[0.5px] border-gray-200 border'>
                            <Plus className='w-4 h-4 text-gray-500' />
                          </div>
                          <div className='grow text-left font-normal text-[14px] text-gray-700'>{createText}</div>
                          <ChevronRight className='shrink-0 w-3.5 h-3.5  text-gray-500'/>
                        </div>
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
                        <Menu.Items className={cn(
                          'absolute top-[3px] right-[-198px] min-w-[200px] z-10 bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg',
                        )}>
                          <div className='p-1'>
                            <div className={cn('flex items-center px-3 py-[6px] rounded-lg cursor-pointer hover:bg-gray-100 text-gray-700 font-normal')} onClick={() => onCreate('blank')}>
                              <FilePlus01 className='shrink-0 mr-2 w-4 h-4 text-gray-600' />
                              {t('app.newApp.startFromBlank')}
                            </div>
                            <div className={cn('flex items-center px-3 py-[6px] rounded-lg cursor-pointer hover:bg-gray-100 text-gray-700 font-normal')} onClick={() => onCreate('template')}>
                              <FilePlus02 className='shrink-0 mr-2 w-4 h-4 text-gray-600' />
                              {t('app.newApp.startFromTemplate')}
                            </div>
                          </div>
                          <div className='p-1 border border-top-[1px] border-gray-100'>
                            <div className={cn('flex items-center px-3 py-[6px] rounded-lg cursor-pointer hover:bg-gray-100 text-gray-700 font-normal')} onClick={() => onCreate('dsl')}>
                              <FileArrow01 className='shrink-0 mr-2 w-4 h-4 text-gray-600' />
                              {t('app.importDSL')}
                            </div>
                          </div>
                        </Menu.Items>
                      </Transition>
                    </>
                  )}
                </Menu>
              )}
            </Menu.Items>
          </>
        )}
      </Menu>
    </div>
  )
}

export default NavSelector
