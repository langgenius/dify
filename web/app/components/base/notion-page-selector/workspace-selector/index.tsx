'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { RiArrowDownSLine } from '@remixicon/react'
import NotionIcon from '../../notion-icon'
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
            <MenuButton className={`flex h-7 items-center justify-center rounded-md p-1 pr-2 hover:bg-state-base-hover ${open && 'bg-state-base-hover'} cursor-pointer`}>
              <NotionIcon
                className='mr-2'
                src={currentWorkspace?.workspace_icon}
                name={currentWorkspace?.workspace_name}
              />
              <div className='mr-1 w-[90px] truncate text-left text-sm font-medium text-text-secondary' title={currentWorkspace?.workspace_name}>{currentWorkspace?.workspace_name}</div>
              {/* <div className='mr-1 px-1 h-[18px] bg-primary-50 rounded-lg text-xs font-medium text-text-accent'>{currentWorkspace?.pages.length}</div> */}
              <RiArrowDownSLine className='h-4 w-4 text-text-secondary' />
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
                className='absolute left-0 top-8 z-10 w-80
                  origin-top-right rounded-lg border-[0.5px]
                  border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'
              >
                <div className="max-h-50 overflow-auto p-1">
                  {
                    items.map(item => (
                      <MenuItem key={item.workspace_id}>
                        <div
                          className='flex h-9 cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover'
                          onClick={() => onSelect(item.workspace_id)}
                        >
                          <NotionIcon
                            className='mr-2 shrink-0'
                            src={item.workspace_icon}
                            name={item.workspace_name}
                          />
                          <div className='system-sm-medium mr-2 grow truncate text-text-secondary' title={item.workspace_name}>{item.workspace_name}</div>
                          <div className='system-xs-medium shrink-0 text-text-accent'>
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
