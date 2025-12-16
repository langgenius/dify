import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter } from 'next/navigation'
import { produce } from 'immer'
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
import type { AnnotationReplyConfig } from '@/models/debug'

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

  const updateAnnotationReply = useCallback((newConfig: AnnotationReplyConfig) => {
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
          <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-600 p-1 shadow-xs'>
            <MessageFast className='h-4 w-4 text-text-primary-on-surface' />
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
            <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{t('appDebug.feature.annotation.description')}</div>
          )}
          {!!annotationReply?.enabled && (
            <>
              {!isHovering && (
                <div className='flex items-center gap-4 pt-0.5'>
                  <div className=''>
                    <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.feature.annotation.scoreThreshold.title')}</div>
                    <div className='system-xs-regular text-text-secondary'>{annotationReply.score_threshold || '-'}</div>
                  </div>
                  <div className='h-[27px] w-px rotate-12 bg-divider-subtle'></div>
                  <div className=''>
                    <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('common.modelProvider.embeddingModel.key')}</div>
                    <div className='system-xs-regular text-text-secondary'>{annotationReply.embedding_model?.embedding_model_name}</div>
                  </div>
                </div>
              )}
              {isHovering && (
                <div className='flex items-center justify-between'>
                  <Button className='w-[178px]' onClick={() => setIsShowAnnotationConfigInit(true)} disabled={disabled}>
                    <RiEqualizer2Line className='mr-1 h-4 w-4' />
                    {t('common.operation.params')}
                  </Button>
                  <Button className='w-[178px]' onClick={() => {
                    router.push(`/app/${appId}/annotations`)
                  }}>
                    <RiExternalLinkLine className='mr-1 h-4 w-4' />
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
