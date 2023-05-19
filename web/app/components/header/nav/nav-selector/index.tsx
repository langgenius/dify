'use client'
import { Fragment } from 'react'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Menu, Transition } from '@headlessui/react'
import { useRouter } from 'next/navigation'
import Indicator from '../../indicator'
import AppIcon from '@/app/components/base/app-icon'

type NavItem = {
  id: string
  name: string
  link: string
  icon: string
  icon_background: string
}
export interface INavSelectorProps {
  navs: NavItem[]
  curNav?: Omit<NavItem, 'link'>
  createText: string
  onCreate: () => void
}

const itemClassName = `
  flex items-center w-full h-10 px-3 text-gray-700 text-[14px]
  rounded-lg font-normal hover:bg-gray-100 cursor-pointer
`

const NavSelector = ({ curNav, navs, createText, onCreate }: INavSelectorProps) => {
  const router = useRouter()

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
            {curNav?.name}
            <ChevronDownIcon
              className="w-3 h-3 ml-1"
              aria-hidden="true"
            />
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
              absolute -left-11 right-0 mt-1.5 w-60 max-w-80
              divide-y divide-gray-100 origin-top-right rounded-lg bg-white
              shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_rgba(0,0,0,0.05)]
            "
          >
            <div className="px-1 py-1 overflow-auto" style={{ maxHeight: '50vh' }}>
              {
                navs.map((nav) => (
                  <Menu.Item key={nav.id}>
                    <div className={itemClassName} onClick={() => router.push(nav.link)}>
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
        </Transition>
      </Menu>
    </div>
  )
}

export default NavSelector
