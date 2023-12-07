import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ModelProvider } from '../declarations'
import { languageMaps } from '../utils'
import ModelBadge from '../model-badge'
import I18n from '@/context/i18n'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'

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
      className='relative flex flex-col justify-between px-4 py-3 border-[0.5px] border-black/5 rounded-xl shadow-xs hover:shadow-lg'
      style={{ background: provider.background || '#F3F4F6' }}
    >
      <div>
        <div className='py-0.5'>
          <div style={{ background: provider.icon_large[language] }} />
        </div>
      </div>
      {
        provider.description && (
          <div className='mt-1 leading-4 text-xs text-black/[48]'>{provider.description[language]}</div>
        )
      }
      <div className='flex hover:hidden gap-0.5'>
        {
          provider.supported_models_types.map(modelType => (
            <ModelBadge
              key={modelType}
              text={modelType.toLocaleUpperCase()}
            />
          ))
        }
      </div>
      <div className={`
        absolute left-3 right-3 bottom-3 h-7 
        hidden hover:flex justify-center items-center
        rounded-md bg-white border-[0.5px] border-gray-200
        shadow-xs text-xs text-gray-700 cursor-pointer
      `}>
        <Settings01 className='mr-[5px] w-3.5 h-3.5' />
        {t('common.operation.setup')}
      </div>
    </div>
  )
}

export default ProviderCard
