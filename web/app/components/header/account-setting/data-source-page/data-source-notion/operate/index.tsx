'use client'
import { useTranslation } from 'react-i18next'
import { Fragment } from 'react'
import { useSWRConfig } from 'swr'
import {
  RiDeleteBinLine,
  RiLoopLeftLine,
  RiMoreFill,
  RiStickyNoteAddLine,
} from '@remixicon/react'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { syncDataSourceNotion, updateDataSourceNotionAction } from '@/service/common'
import Toast from '@/app/components/base/toast'
import cn from '@/utils/classnames'

type OperateProps = {
  payload: {
    id: string
    total: number
  }
  onAuthAgain: () => void
}
export default function Operate({
  payload,
  onAuthAgain,
}: OperateProps) {
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()

  const updateIntegrates = () => {
    Toast.notify({
      type: 'success',
      message: t('common.api.success'),
    })
    mutate({ url: 'data-source/integrates' })
  }
  const handleSync = async () => {
    await syncDataSourceNotion({ url: `/oauth/data-source/notion/${payload.id}/sync` })
    updateIntegrates()
  }
  const handleRemove = async () => {
    await updateDataSourceNotionAction({ url: `/data-source/integrates/${payload.id}/disable` })
    updateIntegrates()
  }

  return (
    <Menu as="div" className="relative inline-block text-left">
      {
        ({ open }) => (
          <>
            <MenuButton className={cn('flex h-8 w-8 items-center justify-center rounded-lg hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
              <RiMoreFill className='h-4 w-4 text-text-secondary' />
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
              <MenuItems className="absolute right-0 top-9 w-60 max-w-80 origin-top-right rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm">
                <div className="px-1 py-1">
                  <MenuItem>
                    <div
                      className='flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover'
                      onClick={onAuthAgain}
                    >
                      <RiStickyNoteAddLine className='mr-2 mt-[2px] h-4 w-4 text-text-tertiary' />
                      <div>
                        <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.changeAuthorizedPages')}</div>
                        <div className='system-xs-regular text-text-tertiary'>
                          {payload.total} {t('common.dataSource.notion.pagesAuthorized')}
                        </div>
                      </div>
                    </div>
                  </MenuItem>
                  <MenuItem>
                    <div className='flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover' onClick={handleSync}>
                      <RiLoopLeftLine className='mr-2 mt-[2px] h-4 w-4 text-text-tertiary' />
                      <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.sync')}</div>
                    </div>
                  </MenuItem>
                </div>
                <MenuItem>
                  <div className='border-t border-divider-subtle p-1'>
                    <div className='flex cursor-pointer rounded-lg px-3 py-2 hover:bg-state-base-hover' onClick={handleRemove}>
                      <RiDeleteBinLine className='mr-2 mt-[2px] h-4 w-4 text-text-tertiary' />
                      <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.remove')}</div>
                    </div>
                  </div>
                </MenuItem>
              </MenuItems>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
