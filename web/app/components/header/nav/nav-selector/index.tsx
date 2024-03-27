'use client'
import { useCallback } from 'react'
import cn from 'classnames'
import { Menu } from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { debounce } from 'lodash-es'
import Indicator from '../../indicator'
import AppIcon from '@/app/components/base/app-icon'
import { useAppContext } from '@/context/app-context'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
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
  onCreate: () => void
  onLoadmore?: () => void
}

const NavSelector = ({ curNav, navs, createText, onCreate, onLoadmore }: INavSelectorProps) => {
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
              {isCurrentWorkspaceManager && <Menu.Item>
                <div className='p-1' onClick={onCreate}>
                  <div className='flex items-center px-3 py-[6px] rounded-lg cursor-pointer hover:bg-gray-100'>
                    <div className='flex justify-center items-center mr-2 w-6 h-6 bg-gray-100 rounded-[6px] border-[0.5px] border-gray-200 border'>
                      <Plus className='w-4 h-4 text-gray-500' />
                    </div>
                    <div className='font-normal text-[14px] text-gray-700'>{createText}</div>
                  </div>
                </div>
              </Menu.Item>}
            </Menu.Items>
          </>
        )}
      </Menu>
    </div>
  )
}

export default NavSelector
