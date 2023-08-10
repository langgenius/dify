import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { FormValue, Provider, ProviderConfigItem, ProviderWithConfig } from '../declarations'
import Indicator from '../../../indicator'
import Quota from './Quota'
import PrioritySelector from './PrioritySelector'
import { IS_CE_EDITION } from '@/config'
import I18n from '@/context/i18n'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import { changeModelProviderPriority, deleteModelProvider } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'

type ModelCardProps = {
  currentProvider?: Provider
  modelItem: ProviderConfigItem
  onOpenModal: (v?: FormValue) => void
  onUpdate: () => void
}

const ModelCard: FC<ModelCardProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
  onUpdate,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom') as ProviderWithConfig

  const handleOperate = async ({ type, value }: Record<string, string>) => {
    if (type === 'delete') {
      const res = await deleteModelProvider({ url: `/workspaces/current/model-providers/${modelItem.key}` })
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onUpdate()
      }
    }

    if (type === 'priority') {
      const res = await changeModelProviderPriority({
        url: `/workspaces/current/model-providers/${modelItem.key}/preferred-provider-type`,
        body: {
          preferred_provider_type: value,
        },
      })
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        onUpdate()
      }
    }
  }

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
        !IS_CE_EDITION && currentProvider && <Quota currentProvider={currentProvider} />
      }
      {
        custom?.is_valid
          ? (
            <div className='flex items-center px-4 h-12'>
              <Indicator color='green' className='mr-2' />
              <div className='grow text-[13px] font-medium text-gray-700'>API key</div>
              <div
                className='mr-1 px-2 leading-6 rounded-md text-xs font-medium text-gray-500 hover:bg-gray-50 cursor-pointer'
                onClick={() => onOpenModal(custom?.config)}
              >
                {t('common.operation.edit')}
              </div>
              <PrioritySelector
                onOperate={handleOperate}
                value={currentProvider?.preferred_provider_type}
              />
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
