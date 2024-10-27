import type { FC } from 'react'
import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  ArrowUpRight,
} from '@/app/components/base/icons/src/vender/line/arrows'
import { useModalContext } from '@/context/modal-context'
import { fetchApiBasedExtensionList } from '@/service/common'

type ApiBasedExtensionSelectorProps = {
  value: string
  onChange: (value: string) => void
}

const ApiBasedExtensionSelector: FC<ApiBasedExtensionSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    setShowAccountSettingModal,
    setShowApiBasedExtensionModal,
  } = useModalContext()
  const { data, mutate } = useSWR(
    '/api-based-extension',
    fetchApiBasedExtensionList,
  )
  const handleSelect = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  const currentItem = data?.find(item => item.id === value)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)} className='w-full'>
        {
          currentItem
            ? (
              <div className='flex items-center justify-between pl-3 pr-2.5 h-9 bg-gray-100 rounded-lg cursor-pointer'>
                <div className='text-sm text-gray-900'>{currentItem.name}</div>
                <div className='flex items-center'>
                  <div className='mr-1.5 w-[270px] text-xs text-gray-400 truncate text-right'>
                    {currentItem.api_endpoint}
                  </div>
                  <RiArrowDownSLine className={`w-4 h-4 text-gray-700 ${!open && 'opacity-60'}`} />
                </div>
              </div>
            )
            : (
              <div className='flex items-center justify-between pl-3 pr-2.5 h-9 bg-gray-100 rounded-lg text-sm text-gray-400 cursor-pointer'>
                {t('common.apiBasedExtension.selector.placeholder')}
                <RiArrowDownSLine className={`w-4 h-4 text-gray-700 ${!open && 'opacity-60'}`} />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='w-[calc(100%-32px)] max-w-[576px] z-[102]'>
        <div className='w-full rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg z-10'>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 pt-2 pb-1'>
              <div className='text-xs font-medium text-gray-500'>
                {t('common.apiBasedExtension.selector.title')}
              </div>
              <div
                className='flex items-center text-xs text-primary-600 cursor-pointer'
                onClick={() => setShowAccountSettingModal({ payload: 'api-based-extension' })}
              >
                {t('common.apiBasedExtension.selector.manage')}
                <ArrowUpRight className='ml-0.5 w-3 h-3' />
              </div>
            </div>
            <div className='max-h-[250px] overflow-y-auto'>
              {
                data?.map(item => (
                  <div
                    key={item.id}
                    className='px-3 py-1.5 w-full cursor-pointer hover:bg-gray-50 rounded-md text-left'
                    onClick={() => handleSelect(item.id!)}
                  >
                    <div className='text-sm text-gray-900'>{item.name}</div>
                    <div className='text-xs text-gray-500'>{item.api_endpoint}</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div className='h-[1px] bg-gray-100' />
          <div className='p-1'>
            <div
              className='flex items-center px-3 h-8 text-sm text-primary-600 cursor-pointer'
              onClick={() => setShowApiBasedExtensionModal({ payload: {}, onSaveCallback: () => mutate() })}
            >
              <RiAddLine className='mr-2 w-4 h-4' />
              {t('common.operation.add')}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ApiBasedExtensionSelector
