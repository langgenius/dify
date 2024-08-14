'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
import NotionIcon from '../../notion-icon'
import s from './index.module.css'
import cn from '@/utils/classnames'
import type { DataSourceNotionWorkspace } from '@/models/common'

type WorkspaceSelectorProps = {
  value: string
  items: Omit<DataSourceNotionWorkspace, 'total'>[]
  onSelect: (v: string) => void
}
export default function WorkspaceSelector({
  value,
  items,
  onSelect,
}: WorkspaceSelectorProps) {
  const { t } = useTranslation()
  const currentWorkspace = items.find(item => item.workspace_id === value)

  return (
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <Menu.Button className={`flex items-center justify-center h-7 rounded-md hover:bg-gray-50 ${open && 'bg-gray-50'} cursor-pointer`}>
              <NotionIcon
                className='ml-1 mr-2'
                src={currentWorkspace?.workspace_icon}
                name={currentWorkspace?.workspace_name}
              />
              <div className='mr-1 w-[90px] text-left text-sm font-medium text-gray-700 truncate' title={currentWorkspace?.workspace_name}>{currentWorkspace?.workspace_name}</div>
              <div className='mr-1 px-1 h-[18px] bg-primary-50 rounded-lg text-xs font-medium text-primary-600'>{currentWorkspace?.pages.length}</div>
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
                <div className="p-1 max-h-50 overflow-auto">
                  {
                    items.map(item => (
                      <Menu.Item key={item.workspace_id}>
                        <div
                          className='flex items-center px-3 h-9 hover:bg-gray-50 cursor-pointer'
                          onClick={() => onSelect(item.workspace_id)}
                        >
                          <NotionIcon
                            className='shrink-0 mr-2'
                            src={item.workspace_icon}
                            name={item.workspace_name}
                          />
                          <div className='grow mr-2 text-sm text-gray-700 truncate' title={item.workspace_name}>{item.workspace_name}</div>
                          <div className='shrink-0 text-xs font-medium text-primary-600'>
                            {item.pages.length} {t('common.dataSource.notion.selector.pageSelected')}
                          </div>
                        </div>
                      </Menu.Item>
                    ))
                  }
                </div>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
