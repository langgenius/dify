'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
import cn from 'classnames'
import s from './index.module.css'

export default function WorkspaceSelector() {
  const { t } = useTranslation()

  return (
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <Menu.Button className={`flex items-center justify-center h-7 rounded-md hover:bg-gray-50 ${open && 'bg-gray-50'} cursor-pointer`}>
              <div className='ml-1 mr-2 w-5 h-5 rounded'></div>
              <div className='mr-1 w-[90px] truncate'>Stylezhang's workspace</div>
              <div className='mr-1 w-5 h-[18px] bg-primary-50 rounded-lg text-xs font-medium text-primary-600'>4</div>
              <div className={cn(s['down-arrow'], 'mr-2 w-3 h-3')} />
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
              <Menu.Items
                className={cn(
                  s.popup,
                  `absolute left-0 top-8 w-80
                  origin-top-right rounded-lg bg-white
                  border-[0.5px] border-gray-200`,
                )}
              >
                <div className="p-1">
                  <Menu.Item>
                    <div className='flex items-center px-3 h-9 hover:bg-gray-50 cursor-pointer'>
                      <div className='mr-2 w-5 h-5 rounded'></div>
                      <div className='grow mr-2 text-sm text-gray-700'>LangGenius</div>
                      <div className='text-xs font-medium text-primary-600'>
                        {4} {t('common.dataSource.notion.selector.pageSelected')}
                      </div>
                    </div>
                  </Menu.Item>
                  <Menu.Item>
                    <div className='flex items-center px-3 h-9 hover:bg-gray-50 cursor-pointer'>
                      <div className='mr-2 w-5 h-5 rounded'></div>
                      <div className='grow mr-2 text-sm text-gray-700'>LangGenius</div>
                      <div className='text-xs font-medium text-primary-600'>
                        {4} {t('common.dataSource.notion.selector.pageSelected')}
                      </div>
                    </div>
                  </Menu.Item>
                </div>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
