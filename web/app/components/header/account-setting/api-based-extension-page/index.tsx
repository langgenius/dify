import { useTranslation } from 'react-i18next'
import Item from './item'
import Empty from './empty'
import { useApiBasedExtensionContext } from '@/context/api-based-extension-context'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

const ApiBasedExtensionPage = () => {
  const { t } = useTranslation()
  const { setShowApiBasedExtensionModal } = useApiBasedExtensionContext()

  return (
    <div>
      <Item />
      <Item />
      <Item />
      <Empty />
      <div
        className='flex items-center justify-center px-3 h-8 text-[13px] font-medium text-gray-700 rounded-lg bg-gray-50 cursor-pointer'
        onClick={() => setShowApiBasedExtensionModal({})}
      >
        <Plus className='mr-2 w-4 h-4' />
        {t('common.apiBasedExtension.add')}
      </div>
    </div>
  )
}

export default ApiBasedExtensionPage
