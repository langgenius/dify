'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { usePathname, useRouter } from 'next/navigation'
import ConfigParamModal from './config-param-modal'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'
import Tooltip from '@/app/components/base/tooltip'
import { LinkExternal02, Settings04 } from '@/app/components/base/icons/src/vender/line/general'
import ConfigContext from '@/context/debug-configuration'
import type { EmbeddingModelConfig } from '@/app/components/app/annotation/type'
import { fetchAnnotationConfig, updateAnnotationScore } from '@/service/annotation'
import type { AnnotationReplyConfig as AnnotationReplyConfigType } from '@/models/debug'

type Props = {
  onEmbeddingChange: (embeddingModel: EmbeddingModelConfig) => void
  onScoreChange: (score: number, embeddingModel?: EmbeddingModelConfig) => void
}

export const Item: FC<{ title: string; tooltip: string; children: JSX.Element }> = ({
  title,
  tooltip,
  children,
}) => {
  return (
    <div>
      <div className='flex items-center space-x-1'>
        <div>{title}</div>
        <Tooltip
          popupContent={
            <div className='max-w-[200px] leading-[18px] text-[13px] font-medium text-gray-800'>{tooltip}</div>
          }
        />
      </div>
      <div>{children}</div>
    </div>
  )
}

const AnnotationReplyConfig: FC<Props> = ({
  onEmbeddingChange,
  onScoreChange,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const {
    annotationConfig,
  } = useContext(ConfigContext)

  const [isShowEdit, setIsShowEdit] = React.useState(false)

  return (
    <>
      <Panel
        className="mt-4"
        headerIcon={
          <MessageFast className='w-4 h-4 text-[#444CE7]' />
        }
        title={t('appDebug.feature.annotation.title')}
        headerRight={
          <div className='flex items-center'>
            <div
              className='flex items-center rounded-md h-7 px-3 space-x-1 text-gray-700 cursor-pointer hover:bg-gray-200'
              onClick={() => { setIsShowEdit(true) }}
            >
              <Settings04 className="w-[14px] h-[14px]" />
              <div className='text-xs font-medium'>

                {t('common.operation.params')}
              </div>
            </div>
            <div
              className='ml-1 flex items-center h-7 px-3 space-x-1 leading-[18px] text-xs font-medium text-gray-700 rounded-md cursor-pointer hover:bg-gray-200'
              onClick={() => {
                router.push(`/app/${appId}/annotations`)
              }}>
              <div>{t('appDebug.feature.annotation.cacheManagement')}</div>
              <LinkExternal02 className='w-3.5 h-3.5' />
            </div>
          </div>
        }
        noBodySpacing
      />
      {isShowEdit && (
        <ConfigParamModal
          appId={appId}
          isShow
          onHide={() => {
            setIsShowEdit(false)
          }}
          onSave={async (embeddingModel, score) => {
            const annotationConfig = await fetchAnnotationConfig(appId) as AnnotationReplyConfigType
            let isEmbeddingModelChanged = false
            if (
              embeddingModel.embedding_model_name !== annotationConfig.embedding_model.embedding_model_name
              || embeddingModel.embedding_provider_name !== annotationConfig.embedding_model.embedding_provider_name
            ) {
              await onEmbeddingChange(embeddingModel)
              isEmbeddingModelChanged = true
            }

            if (score !== annotationConfig.score_threshold) {
              await updateAnnotationScore(appId, annotationConfig.id, score)
              if (isEmbeddingModelChanged)
                onScoreChange(score, embeddingModel)

              else
                onScoreChange(score)
            }

            setIsShowEdit(false)
          }}
          annotationConfig={annotationConfig}
        />
      )}
    </>
  )
}
export default React.memo(AnnotationReplyConfig)
