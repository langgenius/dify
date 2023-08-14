import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type {
  FormValue,
  Provider,
  ProviderConfigItem,
  ProviderWithModels,
  ProviderWithQuota,
} from '../declarations'
import Setting from './Setting'
import Card from './Card'
import QuotaCard from './QuotaCard'
import I18n from '@/context/i18n'
import { IS_CE_EDITION } from '@/config'

type ModelItemProps = {
  currentProvider?: Provider
  modelItem: ProviderConfigItem
  onOpenModal: (v?: FormValue) => void
  onOperate: (v: Record<string, any>) => void
  onUpdate: () => void
}

const ModelItem: FC<ModelItemProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
  onOperate,
  onUpdate,
}) => {
  const { locale } = useContext(I18n)
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom') as ProviderWithModels
  const systemFree = currentProvider?.providers.find(p => p.provider_type === 'system' && (p as ProviderWithQuota).quota_type === 'free') as ProviderWithQuota

  return (
    <div className='mb-2 bg-gray-50 rounded-xl'>
      <div className='flex justify-between items-center px-4 h-14'>
        <div className='flex items-center'>
          {modelItem.titleIcon[locale]}
          {
            modelItem.hit && (
              <div className='ml-2 text-xs text-gray-500'>{modelItem.hit[locale]}</div>
            )
          }
        </div>
        <Setting
          currentProvider={currentProvider}
          modelItem={modelItem}
          onOpenModal={onOpenModal}
          onOperate={onOperate}
          onUpdate={onUpdate}
        />
      </div>
      {
        !!custom?.models?.length && (
          <Card
            providerType={modelItem.key}
            models={custom?.models}
            onOpenModal={onOpenModal}
            onOperate={onOperate}
          />
        )
      }
      {
        systemFree?.is_valid && !IS_CE_EDITION && (
          <QuotaCard remainTokens={systemFree.quota_limit - systemFree.quota_used}/>
        )
      }
    </div>
  )
}

export default ModelItem
