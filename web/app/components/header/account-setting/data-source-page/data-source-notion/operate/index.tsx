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
import { Menu, Transition } from '@headlessui/react'
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
            <Menu.Button className={cn('flex items-center justify-center w-8 h-8 rounded-lg hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
              <RiMoreFill className='w-4 h-4 text-text-secondary' />
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
              <Menu.Items className="absolute right-0 top-9 w-60 max-w-80 origin-top-right rounded-xl bg-components-panel-bg-blur backdrop-blur-sm border-[0.5px] border-components-panel-border shadow-lg">
                <div className="px-1 py-1">
                  <Menu.Item>
                    <div
                      className='flex px-3 py-2 hover:bg-state-base-hover rounded-lg cursor-pointer'
                      onClick={onAuthAgain}
                    >
                      <RiStickyNoteAddLine className='mr-2 mt-[2px] w-4 h-4 text-text-tertiary' />
                      <div>
                        <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.changeAuthorizedPages')}</div>
                        <div className='text-text-tertiary system-xs-regular'>
                          {payload.total} {t('common.dataSource.notion.pagesAuthorized')}
                        </div>
                      </div>
                    </div>
                  </Menu.Item>
                  <Menu.Item>
                    <div className='flex px-3 py-2 hover:bg-state-base-hover rounded-lg cursor-pointer' onClick={handleSync}>
                      <RiLoopLeftLine className='mr-2 mt-[2px] w-4 h-4 text-text-tertiary' />
                      <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.sync')}</div>
                    </div>
                  </Menu.Item>
                </div>
                <Menu.Item>
                  <div className='p-1 border-t border-divider-subtle'>
                    <div className='flex px-3 py-2 hover:bg-state-base-hover rounded-lg cursor-pointer' onClick={handleRemove}>
                      <RiDeleteBinLine className='mr-2 mt-[2px] w-4 h-4 text-text-tertiary' />
                      <div className='system-sm-semibold text-text-secondary'>{t('common.dataSource.notion.remove')}</div>
                    </div>
                  </div>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </>
        )
      }
    </Menu>
  )
}
