import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter } from 'next/navigation'
import produce from 'immer'
import { RiEqualizer2Line, RiExternalLinkLine } from '@remixicon/react'
import { MessageFast } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import useAnnotationConfig from '@/app/components/base/features/new-feature-panel/annotation-reply/use-annotation-config'
import ConfigParamModal from '@/app/components/base/features/new-feature-panel/annotation-reply/config-param-modal'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import { ANNOTATION_DEFAULT } from '@/config'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

const AnnotationReply = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const featuresStore = useFeaturesStore()
  const annotationReply = useFeatures(s => s.features.annotationReply)

  const updateAnnotationReply = useCallback((newConfig: any) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      draft.annotationReply = newConfig
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const {
    handleEnableAnnotation,
    handleDisableAnnotation,
    isShowAnnotationConfigInit,
    setIsShowAnnotationConfigInit,
    isShowAnnotationFullModal,
    setIsShowAnnotationFullModal,
  } = useAnnotationConfig({
    appId,
    annotationConfig: annotationReply as any || {
      id: '',
      enabled: false,
      score_threshold: ANNOTATION_DEFAULT.score_threshold,
      embedding_model: {
        embedding_provider_name: '',
        embedding_model_name: '',
      },
    },
    setAnnotationConfig: updateAnnotationReply,
  })

  const handleSwitch = useCallback((enabled: boolean) => {
    if (enabled)
      setIsShowAnnotationConfigInit(true)
    else
      handleDisableAnnotation(annotationReply?.embedding_model as any)
  }, [annotationReply?.embedding_model, handleDisableAnnotation, setIsShowAnnotationConfigInit])

  const [isHovering, setIsHovering] = useState(false)

  return (
    <>
      <FeatureCard
        icon={
          <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
            <MessageFast className='w-4 h-4 text-text-primary-on-surface' />
          </div>
        }
        title={t('appDebug.feature.annotation.title')}
        value={!!annotationReply?.enabled}
        onChange={state => handleSwitch(state)}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        disabled={disabled}
      >
        <>
          {!annotationReply?.enabled && (
            <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.annotation.description')}</div>
          )}
          {!!annotationReply?.enabled && (
            <>
              {!isHovering && (
                <div className='pt-0.5 flex items-center gap-4'>
                  <div className=''>
                    <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('appDebug.feature.annotation.scoreThreshold.title')}</div>
                    <div className='text-text-secondary system-xs-regular'>{annotationReply.score_threshold || '-'}</div>
                  </div>
                  <div className='w-px h-[27px] bg-divider-subtle rotate-12'></div>
                  <div className=''>
                    <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('common.modelProvider.embeddingModel.key')}</div>
                    <div className='text-text-secondary system-xs-regular'>{annotationReply.embedding_model?.embedding_model_name}</div>
                  </div>
                </div>
              )}
              {isHovering && (
                <div className='flex items-center justify-between'>
                  <Button className='w-[178px]' onClick={() => setIsShowAnnotationConfigInit(true)} disabled={disabled}>
                    <RiEqualizer2Line className='mr-1 w-4 h-4' />
                    {t('common.operation.params')}
                  </Button>
                  <Button className='w-[178px]' onClick={() => {
                    router.push(`/app/${appId}/annotations`)
                  }}>
                    <RiExternalLinkLine className='mr-1 w-4 h-4' />
                    {t('appDebug.feature.annotation.cacheManagement')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      </FeatureCard>
      <ConfigParamModal
        appId={appId}
        isInit
        isShow={isShowAnnotationConfigInit}
        onHide={() => {
          setIsShowAnnotationConfigInit(false)
          // showChooseFeatureTrue()
        }}
        onSave={async (embeddingModel, score) => {
          await handleEnableAnnotation(embeddingModel, score)
          setIsShowAnnotationConfigInit(false)
        }}
        annotationConfig={annotationReply as any}
      />
      {isShowAnnotationFullModal && (
        <AnnotationFullModal
          show={isShowAnnotationFullModal}
          onHide={() => setIsShowAnnotationFullModal(false)}
        />
      )}
    </>
  )
}

export default AnnotationReply
