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
import I18n from '@/context/i18n'
import { Plus, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
// import { CoinsStacked01 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
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
          {
            provider.icon_large[language]
              ? (
                <div
                  className='h-6'
                  style={{ background: provider.icon_large[language] }}
                />
              )
              : (
                <div className='flex items-center h-6 text-xs font-semibold text-black'>
                  <div className='flex items-center justify-center mr-2 w-6 h-6 rounded border-[0.5px] border-black/5 bg-gray-50'>
                    <CubeOutline className='w-4 h-4 text-[#98A2B3]' />
                  </div>
                  Default Model Provider Image
                </div>
              )
          }
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
              <ModelBadge
                key={modelType}
                text={modelTypeFormat(modelType)}
              />
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
