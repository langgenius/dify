import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { FormValue, Provider, ProviderConfigItem, ProviderWithConfig, ProviderWithQuota } from '../declarations'
import { ProviderEnum } from '../declarations'
import Indicator from '../../../indicator'
import Selector from '../selector'
import FreeQuota from './FreeQuota'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import { IS_CE_EDITION } from '@/config'

type SettingProps = {
  currentProvider?: Provider
  modelItem: ProviderConfigItem
  onOpenModal: (v?: FormValue) => void
  onOperate: (v: Record<string, any>) => void
  onUpdate: () => void
}

const Setting: FC<SettingProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
  onOperate,
  onUpdate,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const configurable = currentProvider?.model_flexibility === 'configurable'
  const systemFree = currentProvider?.providers.find(p => p.provider_type === 'system' && (p as ProviderWithQuota).quota_type === 'free') as ProviderWithQuota
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom') as ProviderWithConfig

  return (
    <div className='flex items-center'>
      {
        (modelItem.key === ProviderEnum.minimax || modelItem.key === ProviderEnum.spark) && systemFree && !systemFree?.is_valid && !IS_CE_EDITION && locale === 'zh-Hans' && (
          <FreeQuota
            modelItem={modelItem}
            onUpdate={onUpdate}
          />
        )
      }
      {
        modelItem.disable && !IS_CE_EDITION && (
          <div className='flex items-center text-xs text-gray-500'>
            {modelItem.disable.tip[locale]}
            <a
              className={`${locale === 'en' && 'ml-1'} text-primary-600 cursor-pointer`}
              href={modelItem.disable.link.href[locale]}
              target='_blank'
            >
              {modelItem.disable.link.label[locale]}
            </a>
            <div className='mx-2 w-[1px] h-4 bg-black/5' />
          </div>
        )
      }
      {
        configurable && (
          <Button
            className={`!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700 ${!!modelItem.disable && '!text-gray-300'}`}
            onClick={() => onOpenModal()}
          >
            {t('common.operation.add')}
          </Button>
        )
      }
      {
        !configurable && custom?.config && (
          <div className='flex items-center'>
            <Indicator className='mr-3' />
            <Button
              className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
              onClick={() => onOpenModal(custom.config)}
            >
              {t('common.operation.edit')}
            </Button>
            <Selector
              hiddenOptions={!systemFree?.is_valid || IS_CE_EDITION}
              value={currentProvider?.preferred_provider_type}
              onOperate={onOperate}
              className={open => `${open && '!bg-gray-100 shadow-none'} flex justify-center items-center w-7 h-7 bg-white rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer hover:bg-gray-100`}
            />
          </div>
        )
      }
      {
        !configurable && !custom?.config && (
          <Button
            className={`!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700 ${!!modelItem.disable && !IS_CE_EDITION && '!text-gray-300'}`}
            onClick={() => onOpenModal()}
            disabled={!!modelItem.disable && !IS_CE_EDITION}
          >
            {t('common.operation.setup')}
          </Button>
        )
      }
    </div>
  )
}

export default Setting
