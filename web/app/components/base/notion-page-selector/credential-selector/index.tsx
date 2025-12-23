'use client'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { RiArrowDownSLine } from '@remixicon/react'
import * as React from 'react'
import { Fragment, useMemo } from 'react'
import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'

export type NotionCredential = {
  credentialId: string
  credentialName: string
  workspaceIcon?: string
  workspaceName?: string
}

type CredentialSelectorProps = {
  value: string
  items: NotionCredential[]
  onSelect: (v: string) => void
}

const CredentialSelector = ({
  value,
  items,
  onSelect,
}: CredentialSelectorProps) => {
  const currentCredential = items.find(item => item.credentialId === value)!

  const getDisplayName = (item: NotionCredential) => {
    return item.workspaceName || item.credentialName
  }

  const currentDisplayName = useMemo(() => {
    return getDisplayName(currentCredential)
  }, [currentCredential])

  return (
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <MenuButton className={`flex h-7 items-center justify-center rounded-md p-1 pr-2 hover:bg-state-base-hover ${open && 'bg-state-base-hover'} cursor-pointer`}>
              <CredentialIcon
                className="mr-2"
                avatarUrl={currentCredential?.workspaceIcon}
                name={currentDisplayName}
                size={20}
              />
              <div
                className="mr-1 w-[90px] truncate text-left text-sm font-medium text-text-secondary"
                title={currentDisplayName}
              >
                {currentDisplayName}
              </div>
              <RiArrowDownSLine className="h-4 w-4 text-text-secondary" />
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
                className="absolute left-0 top-8 z-10 w-80
                  origin-top-right rounded-lg border-[0.5px]
                  border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5"
              >
                <div className="max-h-50 overflow-auto p-1">
                  {
                    items.map((item) => {
                      const displayName = getDisplayName(item)
                      return (
                        <MenuItem key={item.credentialId}>
                          <div
                            className="flex h-9 cursor-pointer items-center rounded-lg px-3 hover:bg-state-base-hover"
                            onClick={() => onSelect(item.credentialId)}
                          >
                            <CredentialIcon
                              className="mr-2 shrink-0"
                              avatarUrl={item.workspaceIcon}
                              name={displayName}
                              size={20}
                            />
                            <div
                              className="system-sm-medium mr-2 grow truncate text-text-secondary"
                              title={displayName}
                            >
                              {displayName}
                            </div>
                            {/* // ?Cannot get page length with new auth system */}
                            {/* <div className='system-xs-medium shrink-0 text-text-accent'>
                            {item.pages.length} {t('common.dataSource.notion.selector.pageSelected')}
                          </div> */}
                          </div>
                        </MenuItem>
                      )
                    })
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

export default React.memo(CredentialSelector)
