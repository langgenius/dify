import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { FormValue, Provider, ProviderConfigItem, ProviderWithModels } from '../declarations'
import Setting from './Setting'
import Card from './Card'
import I18n from '@/context/i18n'

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
}) => {
  const { locale } = useContext(I18n)
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom') as ProviderWithModels

  return (
    <div className='mb-2 bg-gray-50 rounded-xl'>
      <div className='flex justify-between items-center px-4 h-14'>
        {modelItem.titleIcon[locale]}
        <Setting
          currentProvider={currentProvider}
          modelItem={modelItem}
          onOpenModal={onOpenModal}
          onOperate={onOperate}
        />
      </div>
      {
        !!custom?.models?.length && (
          <Card
            models={custom?.models}
            onOpenModal={onOpenModal}
            onOperate={onOperate}
          />
        )
      }
    </div>
  )
}

export default ModelItem
