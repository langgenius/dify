import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { FormValue, ModelItem, SystemProvider } from '../declarations'
import Indicator from '../../../indicator'
import Quota from './Quota'
import PrioritySelector from './PrioritySelector'
import { IS_CE_EDITION } from '@/config'
import I18n from '@/context/i18n'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'

type ModelCardProps = {
  currentProvider: SystemProvider
  modelItem: ModelItem
  onOpenModal: (v?: FormValue) => void
}

const ModelCard: FC<ModelCardProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const custom = currentProvider.providers[2]

  return (
    <div className='rounded-xl border-[0.5px] border-gray-200 shadow-xs'>
      <div className={`flex px-4 pt-4 pb-3 rounded-t-lg ${modelItem.bgColor}`}>
        <div className='mr-3'>
          <div className='mb-1'>
            {modelItem.titleIcon[locale]}
          </div>
          <div className='h-9 text-xs text-black opacity-60'>{modelItem.desc?.[locale]}</div>
        </div>
        {modelItem.subTitleIcon}
      </div>
      {
        !IS_CE_EDITION && <Quota currentProvider={currentProvider} />
      }
      {
        custom.is_valid
          ? (
            <div className='flex items-center px-4 h-12'>
              <Indicator color='green' className='mr-2' />
              <div className='grow text-[13px] font-medium text-gray-700'>API key</div>
              <div
                className='mr-1 px-2 leading-6 rounded-md text-xs font-medium text-gray-500 hover:bg-gray-50 cursor-pointer'
                onClick={() => onOpenModal(custom.config)}
              >
                {t('common.operation.edit')}
              </div>
              <PrioritySelector />
            </div>
          )
          : (
            <div
              className='inline-flex items-center px-4 h-12 text-gray-500 cursor-pointer hover:text-primary-600'
              onClick={() => onOpenModal()}
            >
              <Plus className='mr-1.5 w-4 h-4'/>
              <div className='text-xs font-medium'>{t('common.modelProvider.addApiKey')}</div>
            </div>
          )
      }
    </div>
  )
}

export default ModelCard
