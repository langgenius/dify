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
              <div className='flex items-center justify-between pl-3 pr-2.5 h-9 bg-components-input-bg-normal rounded-lg cursor-pointer'>
                <div className='text-sm text-text-primary'>{currentItem.name}</div>
                <div className='flex items-center'>
                  <div className='mr-1.5 w-[270px] text-xs text-text-quaternary truncate text-right'>
                    {currentItem.api_endpoint}
                  </div>
                  <RiArrowDownSLine className={`w-4 h-4 text-text-secondary ${!open && 'opacity-60'}`} />
                </div>
              </div>
            )
            : (
              <div className='flex items-center justify-between pl-3 pr-2.5 h-9 bg-components-input-bg-normal rounded-lg text-sm text-text-quaternary cursor-pointer'>
                {t('common.apiBasedExtension.selector.placeholder')}
                <RiArrowDownSLine className={`w-4 h-4 text-text-secondary ${!open && 'opacity-60'}`} />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='w-[calc(100%-32px)] max-w-[576px] z-[102]'>
        <div className='w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg z-10'>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 pt-2 pb-1'>
              <div className='text-xs font-medium text-text-tertiary'>
                {t('common.apiBasedExtension.selector.title')}
              </div>
              <div
                className='flex items-center text-xs text-text-accent cursor-pointer'
                onClick={() => {
                  setOpen(false)
                  setShowAccountSettingModal({ payload: 'api-based-extension' })
                }}
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
                    className='px-3 py-1.5 w-full cursor-pointer hover:stroke-state-base-hover rounded-md text-left'
                    onClick={() => handleSelect(item.id!)}
                  >
                    <div className='text-sm text-text-primary'>{item.name}</div>
                    <div className='text-xs text-text-tertiary'>{item.api_endpoint}</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div className='h-[1px] bg-divider-regular' />
          <div className='p-1'>
            <div
              className='flex items-center px-3 h-8 text-sm text-text-accent cursor-pointer'
              onClick={() => {
                setOpen(false)
                setShowApiBasedExtensionModal({ payload: {}, onSaveCallback: () => mutate() })
              }}
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
