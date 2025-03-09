'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
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
            <Menu.Button className={`flex items-center justify-center h-7 p-1 pr-2 rounded-md hover:bg-state-base-hover ${open && 'bg-state-base-hover'} cursor-pointer`}>
              <NotionIcon
                className='mr-2'
                src={currentWorkspace?.workspace_icon}
                name={currentWorkspace?.workspace_name}
              />
              <div className='mr-1 w-[90px] text-left text-sm font-medium text-text-secondary truncate' title={currentWorkspace?.workspace_name}>{currentWorkspace?.workspace_name}</div>
              {/* <div className='mr-1 px-1 h-[18px] bg-primary-50 rounded-lg text-xs font-medium text-text-accent'>{currentWorkspace?.pages.length}</div> */}
              <RiArrowDownSLine className='w-4 h-4 text-text-secondary' />
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
                className='absolute left-0 top-8 z-10 w-80
                  origin-top-right rounded-lg bg-components-panel-bg-blur
                  border-[0.5px] border-components-panel-border shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'
              >
                <div className="p-1 max-h-50 overflow-auto">
                  {
                    items.map(item => (
                      <Menu.Item key={item.workspace_id}>
                        <div
                          className='flex items-center px-3 h-9 rounded-lg hover:bg-state-base-hover cursor-pointer'
                          onClick={() => onSelect(item.workspace_id)}
                        >
                          <NotionIcon
                            className='shrink-0 mr-2'
                            src={item.workspace_icon}
                            name={item.workspace_name}
                          />
                          <div className='grow mr-2 system-sm-medium text-text-secondary truncate' title={item.workspace_name}>{item.workspace_name}</div>
                          <div className='shrink-0 system-xs-medium text-text-accent'>
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
