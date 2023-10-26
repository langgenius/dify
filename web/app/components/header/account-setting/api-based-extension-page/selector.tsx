import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  ArrowUpRight,
  ChevronDown,
} from '@/app/components/base/icons/src/vender/line/arrows'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import { useModalContext } from '@/context/modal-context'

const ApiBasedExtensionSelector = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    setShowAccountSettingModal,
    setShowApiBasedExtensionModal,
  } = useModalContext()

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)} className='w-full'>
        <div className='flex items-center justify-between pl-3 pr-2.5 h-9 bg-gray-100 rounded-lg'>
          <div className='text-sm text-gray-900'>Data Search API</div>
          <div className='flex items-center'>
            <div className='mr-1.5 w-[270px] text-xs text-gray-400 truncate'>
              opendatanetwork.com/api/datasets/opendataopendatanetwork.com/api/datasets/opendata
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-700 ${!open && 'opacity-60'}`} />
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='w-[576px] z-[11]'>
        <div className='w-full rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg z-10'>
          <div className='p-1'>
            <div className='flex items-center justify-between px-3 pt-2 pb-1'>
              <div className='text-xs font-medium text-gray-500'>
                {t('common.apiBasedExtension.selector.title')}
              </div>
              <div className='flex items-center text-xs text-primary-600' onClick={() => setShowAccountSettingModal('api-based-extension')}>
                {t('common.apiBasedExtension.selector.manage')}
                <ArrowUpRight className='ml-0.5 w-3 h-3' />
              </div>
            </div>
            <div className='px-3 py-1.5 w-full cursor-pointer hover:bg-gray-50 rounded-md text-left'>
              <div className='text-sm text-gray-900'>User Registration Event API</div>
              <div className='text-xs text-gray-500'>https://api.example.com/webhooks/user-registration</div>
            </div>
          </div>
          <div className='h-[1px] bg-gray-100' />
          <div className='p-1'>
            <div
              className='flex items-center px-3 h-8 text-sm text-primary-600 cursor-pointer'
              onClick={() => setShowApiBasedExtensionModal({})}
            >
              <Plus className='mr-2 w-4 h-4' />
              {t('common.operation.add')}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ApiBasedExtensionSelector
