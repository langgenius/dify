import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ModelItem as TModelItem, TModelProvider } from '../declarations'
import Indicator from '../../../indicator'
import Operation from './Operation'
import s from './index.module.css'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'

type SettingProps = {
  currentProvider?: TModelProvider
  modelItem: TModelItem
  onOpenModal: () => void
  onOperate: () => void
}

const Setting: FC<SettingProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const configurable = currentProvider?.model_flexibility === 'configurable'
  const systemFree = currentProvider?.providers.find(p => p.provider_type === 'system' && p.quota_type === 'free')
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom')

  return (
    <div className='flex items-center'>
      {
        modelItem.vender && !systemFree.is_valid && (
          <div className='flex items-center'>
            📣
            <div className={`${s.vender} ml-1 mr-2 text-xs font-medium text-transparent`}>{modelItem.vender?.[locale]}</div>
            <Button
              type='primary'
              className='!px-3 !h-7 rounded-md !text-xs font-medium text-gray-700'
              onClick={() => {}}
            >
              Get for free
            </Button>
            <div className='mx-2 w-[1px] h-4 bg-black/5' />
          </div>
        )
      }
      {
        modelItem.disable && (
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
            onClick={onOpenModal}
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
              onClick={onOpenModal}
            >
              {t('common.operation.edit')}
            </Button>
            <Operation onOperate={() => {}} />
          </div>
        )
      }
      {
        !configurable && !custom?.config && (
          <Button
            className={`!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700 ${!!modelItem.disable && '!text-gray-300'}`}
            onClick={onOpenModal}
            disabled={!!modelItem.disable}
          >
            {t('common.operation.setup')}
          </Button>
        )
      }
    </div>
  )
}

export default Setting
