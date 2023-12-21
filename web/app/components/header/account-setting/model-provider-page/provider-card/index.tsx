import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ModelProvider } from '../declarations'
import { ConfigurateMethodEnum } from '../declarations'
import {
  DEFAULT_BACKGROUND_COLOR,
  languageMaps,
  modelTypeFormat,
} from '../utils'
import ModelBadge from '../model-badge'
import ProviderIcon from '../provider-icon'
import I18n from '@/context/i18n'
import { Plus, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
// import { CoinsStacked01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Button from '@/app/components/base/button'

type ProviderCardProps = {
  provider: ModelProvider
  onOpenModal: (configurateMethod: ConfigurateMethodEnum) => void
}
const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  onOpenModal,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]
  const configurateMethods = provider.configurate_methods.filter(method => method !== ConfigurateMethodEnum.fetchFromRemote)

  return (
    <div
      className='group relative flex flex-col justify-between px-4 py-3 h-[148px] border-[0.5px] border-black/5 rounded-xl shadow-xs hover:shadow-lg'
      style={{ background: provider.background || DEFAULT_BACKGROUND_COLOR }}
    >
      <div>
        <div className='py-0.5'>
          <ProviderIcon provider={provider} />
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
            provider.supported_model_types.map(modelType => (
              <ModelBadge key={modelType}>
                {modelTypeFormat(modelType)}
              </ModelBadge>
            ))
          }
        </div>
        <div className={`hidden group-hover:grid grid-cols-${configurateMethods.length} gap-1`}>
          {
            configurateMethods.map((method) => {
              if (method === ConfigurateMethodEnum.predefinedModel) {
                return (
                  <Button
                    key={method}
                    className='h-7 bg-white text-xs text-gray-700'
                    onClick={() => onOpenModal(method)}
                  >
                    <Settings01 className='mr-[5px] w-3.5 h-3.5' />
                    {t('common.operation.setup')}
                  </Button>
                )
              }
              return (
                <Button
                  key={method}
                  className='px-0 h-7 bg-white text-xs text-gray-700'
                  onClick={() => onOpenModal(method)}
                >
                  <Plus className='mr-[5px] w-3.5 h-3.5' />
                  Add Model
                </Button>
              )
            })
          }
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
