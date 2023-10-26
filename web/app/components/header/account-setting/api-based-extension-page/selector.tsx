import { useTranslation } from 'react-i18next'
import { Popover } from '@headlessui/react'
import {
  ArrowUpRight,
  ChevronDown,
} from '@/app/components/base/icons/src/vender/line/arrows'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

const ApiBasedExtensionSelector = () => {
  const { t } = useTranslation()

  return (
    <Popover className='relative'>
      <Popover.Button className='flex items-center justify-between pl-3 pr-2.5 w-full h-9 bg-gray-100 rounded-lg'>
        <div className='text-sm text-gray-900'>Data Search API</div>
        <div className='flex items-center'>
          <div className='mr-1.5 w-[270px] text-xs text-gray-400 truncate'>
            opendatanetwork.com/api/datasets/opendataopendatanetwork.com/api/datasets/opendata
          </div>
          <ChevronDown className='w-4 h-4 text-gray-700' />
        </div>
      </Popover.Button>
      <Popover.Panel className='absolute top-10 left-0 w-full rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg z-10'>
        <div className='p-1'>
          <div className='flex items-center justify-between px-3 pt-2 pb-1'>
            <div className='text-xs font-medium text-gray-500'>
              {t('common.apiBasedExtension.selector.title')}
            </div>
            <div className='flex items-center text-xs text-primary-600'>
              {t('common.apiBasedExtension.selector.manage')}
              <ArrowUpRight className='ml-0.5 w-3 h-3' />
            </div>
          </div>
          <div className='px-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded-md'>
            <div className='text-sm text-gray-900'>User Registration Event API</div>
            <div className='text-xs text-gray-500'>https://api.example.com/webhooks/user-registration</div>
          </div>
        </div>
        <div className='h-[1px] bg-gray-100' />
        <div className='p-1'>
          <div className='flex items-center px-3 h-8 text-sm text-primary-600 cursor-pointer'>
            <Plus className='mr-2 w-4 h-4' />
            {t('common.operation.add')}
          </div>
        </div>
      </Popover.Panel>
    </Popover>
  )
}

export default ApiBasedExtensionSelector
