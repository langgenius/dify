import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import type {
  ModelProvider,
} from '../declarations'
import { ConfigurationMethodEnum } from '../declarations'
import {
  DEFAULT_BACKGROUND_COLOR,
  modelTypeFormat,
} from '../utils'
import {
  useLanguage,
} from '../hooks'
import ModelBadge from '../model-badge'
import ProviderIcon from '../provider-icon'
import s from './index.module.css'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import Button from '@/app/components/base/button'
import { useAppContext } from '@/context/app-context'

type ProviderCardProps = {
  provider: ModelProvider
  onOpenModal: (configurateMethod: ConfigurationMethodEnum) => void
}

const ProviderCard: FC<ProviderCardProps> = ({
  provider,
  onOpenModal,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { isCurrentWorkspaceManager } = useAppContext()
  const configurateMethods = provider.configurate_methods.filter(method => method !== ConfigurationMethodEnum.fetchFromRemote)

  return (
    <div
      className='group relative flex flex-col px-4 py-3 h-[148px] border-[0.5px] border-black/5 rounded-xl shadow-xs hover:shadow-lg'
      style={{ background: provider.background || DEFAULT_BACKGROUND_COLOR }}
    >
      <div className='grow h-0'>
        <div className='py-0.5'>
          <ProviderIcon provider={provider} />
        </div>
        {
          provider.description && (
            <div
              className='mt-1 leading-4 text-xs text-black/[48] line-clamp-4'
              title={provider.description[language] || provider.description.en_US}
            >
              {provider.description[language] || provider.description.en_US}
            </div>
          )
        }
      </div>
      <div className='shrink-0'>
        <div className={'flex flex-wrap group-hover:hidden gap-0.5'}>
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
              if (method === ConfigurationMethodEnum.predefinedModel) {
                return (
                  <Button
                    key={method}
                    className={'h-7 text-xs shrink-0'}
                    onClick={() => onOpenModal(method)}
                    disabled={!isCurrentWorkspaceManager}
                  >
                    <Settings01 className={`mr-[5px] w-3.5 h-3.5 ${s.icon}`} />
                    <span className='text-xs inline-flex items-center justify-center overflow-ellipsis shrink-0'>{t('common.operation.setup')}</span>
                  </Button>
                )
              }
              return (
                <Button
                  key={method}
                  className='px-0 h-7 text-xs'
                  onClick={() => onOpenModal(method)}
                  disabled={!isCurrentWorkspaceManager}
                >
                  <RiAddLine className='mr-[5px] w-3.5 h-3.5' />
                  {t('common.modelProvider.addModel')}
                </Button>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}

export default ProviderCard
