'use client'
import { useTranslation } from 'react-i18next'
import { Fragment, useState } from 'react'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/solid'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { useRouter } from 'next/navigation'
import Indicator from '../indicator'
import type { AppDetailResponse } from '@/models/app'
import CreateAppDialog from '@/app/components/app/create-app-dialog'
import AppIcon from '@/app/components/base/app-icon'
import { useAppContext } from '@/context/app-context'
import { noop } from 'lodash-es'

type IAppSelectorProps = {
  appItems: AppDetailResponse[]
  curApp: AppDetailResponse
}

export default function AppSelector({ appItems, curApp }: IAppSelectorProps) {
  const router = useRouter()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const { t } = useTranslation()

  const itemClassName = `
    flex items-center w-full h-10 px-3 text-gray-700 text-[14px]
    rounded-lg font-normal hover:bg-gray-100 cursor-pointer
  `

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        <div>
          <MenuButton
            className="
              inline-flex h-7 w-full items-center justify-center
              rounded-[10px] pl-2 pr-2.5 text-[14px] font-semibold
              text-[#1C64F2] hover:bg-[#EBF5FF]
            "
          >
            {curApp?.name}
            <ChevronDownIcon
              className="ml-1 h-3 w-3"
              aria-hidden="true"
            />
          </MenuButton>
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
          <MenuItems
            className="
              absolute -left-11 right-0 mt-1.5 w-60 max-w-80
              origin-top-right divide-y divide-gray-100 rounded-lg bg-white
              shadow-lg
            "
          >
            {!!appItems.length && (<div className="overflow-auto px-1 py-1" style={{ maxHeight: '50vh' }}>
              {
                appItems.map((app: AppDetailResponse) => (
                  <MenuItem key={app.id}>
                    <div className={itemClassName} onClick={() =>
                      router.push(`/app/${app.id}/${isCurrentWorkspaceEditor ? 'configuration' : 'overview'}`)
                    }>
                      <div className='relative mr-2 h-6 w-6 rounded-[6px] bg-[#D5F5F6]'>
                        <AppIcon size='tiny' />
                        <div className='absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded bg-white'>
                          <Indicator />
                        </div>
                      </div>
                      {app.name}
                    </div>
                  </MenuItem>
                ))
              }
            </div>)}
            {isCurrentWorkspaceEditor && <MenuItem>
              <div className='p-1' onClick={() => setShowNewAppDialog(true)}>
                <div
                  className='flex h-12 cursor-pointer items-center rounded-lg hover:bg-gray-100'
                >
                  <div
                    className='
                      ml-4 mr-2 flex
                      h-6 w-6 items-center justify-center rounded-[6px] border-[0.5px]
                      border-dashed border-gray-200 bg-gray-100
                    '
                  >
                    <PlusIcon className='h-4 w-4 text-gray-500' />
                  </div>
                  <div className='text-[14px] font-normal text-gray-700'>{t('common.menus.newApp')}</div>
                </div>
              </div>
            </MenuItem>
            }
          </MenuItems>
        </Transition>
      </Menu>
      <CreateAppDialog
        show={showNewAppDialog}
        onClose={() => setShowNewAppDialog(false)}
        onSuccess={noop}
      />
    </div>
  )
}
