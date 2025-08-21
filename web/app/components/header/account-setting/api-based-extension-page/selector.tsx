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
              <div className='flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal pl-3 pr-2.5'>
                <div className='text-sm text-text-primary'>{currentItem.name}</div>
                <div className='flex items-center'>
                  <div className='mr-1.5 w-[270px] truncate text-right text-xs text-text-quaternary'>
                    {currentItem.api_endpoint}
                  </div>
                  <RiArrowDownSLine className={`h-4 w-4 text-text-secondary ${!open && 'opacity-60'}`} />
                </div>
              </div>
            )
            : (
              <div className='flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal pl-3 pr-2.5 text-sm text-text-quaternary'>
                {t('common.apiBasedExtension.selector.placeholder')}
                <RiArrowDownSLine className={`h-4 w-4 text-text-secondary ${!open && 'opacity-60'}`} />
              </div>
            )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[102] w-[calc(100%-32px)] max-w-[576px]'>
        <div className='z-10 w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg'>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 pb-1 pt-2'>
              <div className='text-xs font-medium text-text-tertiary'>
                {t('common.apiBasedExtension.selector.title')}
              </div>
              <div
                className='flex cursor-pointer items-center text-xs text-text-accent'
                onClick={() => {
                  setOpen(false)
                  setShowAccountSettingModal({ payload: 'api-based-extension' })
                }}
              >
                {t('common.apiBasedExtension.selector.manage')}
                <ArrowUpRight className='ml-0.5 h-3 w-3' />
              </div>
            </div>
            <div className='max-h-[250px] overflow-y-auto'>
              {
                data?.map(item => (
                  <div
                    key={item.id}
                    className='w-full cursor-pointer rounded-md px-3 py-1.5 text-left hover:stroke-state-base-hover'
                    onClick={() => handleSelect(item.id!)}
                  >
                    <div className='text-sm text-text-primary'>{item.name}</div>
                    <div className='text-xs text-text-tertiary'>{item.api_endpoint}</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div className='h-px bg-divider-regular' />
          <div className='p-1'>
            <div
              className='flex h-8 cursor-pointer items-center px-3 text-sm text-text-accent'
              onClick={() => {
                setOpen(false)
                setShowApiBasedExtensionModal({ payload: {}, onSaveCallback: () => mutate() })
              }}
            >
              <RiAddLine className='mr-2 h-4 w-4' />
              {t('common.operation.add')}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ApiBasedExtensionSelector
