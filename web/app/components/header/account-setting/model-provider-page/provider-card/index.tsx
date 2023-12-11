import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ModelProvider } from '../declarations'
import {
  DEFAULT_BACKGROUND_COLOR,
  languageMaps,
} from '../utils'
import ModelBadge from '../model-badge'
import I18n from '@/context/i18n'
import { Plus, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
// import { CoinsStacked01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Button from '@/app/components/base/button'

type ProviderCardProps = {
  provider: ModelProvider
}
const ProviderCard: FC<ProviderCardProps> = ({
  provider,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]

  return (
    <div
      className='group relative flex flex-col justify-between px-4 py-3 h-[148px] border-[0.5px] border-black/5 rounded-xl shadow-xs hover:shadow-lg'
      style={{ background: provider.background || DEFAULT_BACKGROUND_COLOR }}
    >
      <div>
        <div className='py-0.5'>
          <div className='h-6' style={{ background: provider.icon_large[language] }} />
        </div>
        {
          provider.description && (
            <div className='mt-1 leading-4 text-xs text-black/[48]'>{provider.description[language]}</div>
          )
        }
      </div>
      <div>
        <div className='flex flex-wrap group-hover:hidden gap-0.5'>
          {
            provider.supported_models_types.map(modelType => (
              <ModelBadge
                key={modelType}
                text={modelType.toLocaleUpperCase()}
              />
            ))
          }
        </div>
        <div className='hidden group-hover:grid grid-cols-2 gap-1'>
          <Button className='h-7 bg-white text-xs text-gray-700'>
            <Settings01 className='mr-[5px] w-3.5 h-3.5' />
            {t('common.operation.setup')}
          </Button>
          <Button className='px-0 h-7 bg-white text-xs text-gray-700'>
            <Plus className='mr-[5px] w-3.5 h-3.5' />
            Add Model
          </Button>
          {/* <Button className='h-7 text-xs text-gray-700'>
            <CoinsStacked01 className='mr-[5px] w-3.5 h-3.5' />
            Buy Quota
          </Button> */}
        </div>
      </div>
    </div>
  )
}

export default ProviderCard
