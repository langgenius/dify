'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname, useRouter } from 'next/navigation'
import ScoreSlider from './score-slider'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { HelpCircle, LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import ConfigContext from '@/context/debug-configuration'
import ModelSelector from '@/app/components/header/account-setting/model-page/model-selector/portal-select'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'

type Props = {}

export const Item: FC<{ title: string; tooltip: string; children: JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className='flex items-center space-x-1'>
        <div>{title}</div>
        <TooltipPlus
          popupContent={
            <div className='max-w-[200px] leading-[18px] text-[13px] font-medium text-gray-800'>{tooltip}</div>
          }
        >
          <HelpCircle className='w-3.5 h-3.5 text-gray-400' />
        </TooltipPlus>
      </div>
      <div>{children}</div>
    </div>
  )
}

const AnnotationReplyConfig: FC<Props> = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const {
    annotationConfig,
    setAnnotationConfig,
  } = useContext(ConfigContext)

  return (
    <Panel
      className="mt-4"
      headerIcon={
        <MessageFast className='w-4 h-4 text-[#444CE7]' />
      }
      title={t('appDebug.feature.annotation.title')}
      headerRight={
        <div className='flex items-center space-x-1 leading-[18px] text-xs font-medium text-gray-700 cursor-pointer' onClick={() => {
          router.push(`/app/${appId}/annotations`)
        }}>
          <div>{t('appDebug.feature.annotation.cacheManagement')}</div>
          <LinkExternal02 className='w-3.5 h-3.5' />
        </div>
      }
    >
      <div className='p-4 pt-3 rounded-lg border border-gray-200 bg-white space-y-2'>
        <Item
          title={t('appDebug.feature.annotation.scoreThreshold.title')}
          tooltip={t('appDebug.feature.annotation.scoreThreshold.description')}
        >
          <ScoreSlider
            className='mt-1'
            value={annotationConfig.score_threshold * 100}
            onChange={(val) => {
              setAnnotationConfig({
                ...annotationConfig,
                score_threshold: val / 100,
              })
            }}
          />
        </Item>
        <Item
          title={t('common.modelProvider.embeddingModel.key')}
          tooltip={t('common.modelProvider.embeddingModel.tip')}
        >
          <div className='pt-1'>
            <ModelSelector
              widthSameToTrigger
              value={{
                providerName: annotationConfig.embedding_model?.embedding_provider_name as ProviderEnum,
                modelName: annotationConfig.embedding_model?.embedding_model_name,
              }}
              modelType={ModelType.embeddings}
              onChange={(val) => {
                setAnnotationConfig({
                  ...annotationConfig,
                  embedding_model: {
                    embedding_provider_name: val.model_provider.provider_name,
                    embedding_model_name: val.model_name,
                  },
                })
              }}
            />
          </div>
        </Item>

      </div>
    </Panel>
  )
}
export default React.memo(AnnotationReplyConfig)
