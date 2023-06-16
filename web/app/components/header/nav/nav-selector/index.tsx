'use client'
import { useCallback } from 'react'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Menu } from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { debounce } from 'lodash-es'
import Indicator from '../../indicator'
import AppIcon from '@/app/components/base/app-icon'

type NavItem = {
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

const itemClassName = `
  flex items-center w-full h-10 px-3 text-gray-700 text-[14px]
  rounded-lg font-normal hover:bg-gray-100 cursor-pointer truncate
`

const NavSelector = ({ curNav, navs, createText, onCreate, onLoadmore }: INavSelectorProps) => {
  const router = useRouter()

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
        <div>
          <Menu.Button
            className="
              inline-flex items-center w-full h-7 justify-center
              rounded-[10px] pl-2 pr-2.5 text-[14px] font-semibold
              text-[#1C64F2] hover:bg-[#EBF5FF]
            "
          >
            <div className='max-w-[180px] truncate' title={curNav?.name}>{curNav?.name}</div>
            <ChevronDownIcon
              className="shrink-0 w-3 h-3 ml-1"
              aria-hidden="true"
            />
          </Menu.Button>
        </div>
        <Menu.Items
          className="
            absolute -left-11 right-0 mt-1.5 w-60 max-w-80
            divide-y divide-gray-100 origin-top-right rounded-lg bg-white
            shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_rgba(0,0,0,0.05)]
          "
        >
          <div className="px-1 py-1 overflow-auto" style={{ maxHeight: '50vh' }} onScroll={handleScroll}>
            {
              navs.map(nav => (
                <Menu.Item key={nav.id}>
                  <div className={itemClassName} onClick={() => router.push(nav.link)} title={nav.name}>
                    <div className='relative w-6 h-6 mr-2 bg-[#D5F5F6] rounded-[6px]'>
                      <AppIcon size='tiny' icon={nav.icon} background={nav.icon_background}/>
                      <div className='flex justify-center items-center absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 bg-white rounded'>
                        <Indicator />
                      </div>
                    </div>
                    {nav.name}
                  </div>
                </Menu.Item>
              ))
            }
          </div>
          <Menu.Item>
            <div className='p-1' onClick={onCreate}>
              <div
                className='flex items-center h-12 rounded-lg cursor-pointer hover:bg-gray-100'
              >
                <div
                  className='
                    flex justify-center items-center
                    ml-4 mr-2 w-6 h-6 bg-gray-100 rounded-[6px]
                    border-[0.5px] border-gray-200 border-dashed
                  '
                >
                  <PlusIcon className='w-4 h-4 text-gray-500' />
                </div>
                <div className='font-normal text-[14px] text-gray-700'>{createText}</div>
              </div>
            </div>
          </Menu.Item>
        </Menu.Items>
      </Menu>
    </div>
  )
}

export default NavSelector
