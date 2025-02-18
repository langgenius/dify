'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
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
            <MenuButton className={`flex h-7 items-center justify-center rounded-md hover:bg-gray-50 ${open && 'bg-gray-50'} cursor-pointer`}>
              <NotionIcon
                className='ml-1 mr-2'
                src={currentWorkspace?.workspace_icon}
                name={currentWorkspace?.workspace_name}
              />
              <div className='mr-1 w-[90px] truncate text-left text-sm font-medium text-gray-700' title={currentWorkspace?.workspace_name}>{currentWorkspace?.workspace_name}</div>
              <div className='bg-primary-50 text-primary-600 mr-1 h-[18px] rounded-lg px-1 text-xs font-medium'>{currentWorkspace?.pages.length}</div>
              <div className={cn(s['down-arrow'], 'mr-2 h-3 w-3')} />
            </MenuButton>
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
                className={cn(
                  s.popup,
                  `absolute left-0 top-8 w-80
                  origin-top-right rounded-lg border-[0.5px]
                  border-gray-200 bg-white`,
                )}
              >
                <div className="max-h-50 overflow-auto p-1">
                  {
                    items.map(item => (
                      <MenuItem key={item.workspace_id}>
                        <div
                          className='flex h-9 cursor-pointer items-center px-3 hover:bg-gray-50'
                          onClick={() => onSelect(item.workspace_id)}
                        >
                          <NotionIcon
                            className='mr-2 shrink-0'
                            src={item.workspace_icon}
                            name={item.workspace_name}
                          />
                          <div className='mr-2 grow truncate text-sm text-gray-700' title={item.workspace_name}>{item.workspace_name}</div>
                          <div className='text-primary-600 shrink-0 text-xs font-medium'>
                            {item.pages.length} {t('common.dataSource.notion.selector.pageSelected')}
                          </div>
                        </div>
                      </MenuItem>
                    ))
                  }
                </div>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
