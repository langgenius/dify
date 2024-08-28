import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter } from 'next/navigation'
import produce from 'immer'
import {
  RiCloseLine,
  RiEqualizer2Line,
  RiExternalLinkLine,
} from '@remixicon/react'
import {
  FolderUpload,
  MessageFast,
} from '@/app/components/base/icons/src/vender/features'
import DialogWrapper from '@/app/components/base/features/new-feature-panel/dialog-wrapper'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'
import Switch from '@/app/components/base/switch'
import Button from '@/app/components/base/button'

import MoreLikeThis from '@/app/components/base/features/new-feature-panel/more-like-this'
import ConversationOpener from '@/app/components/base/features/new-feature-panel/conversation-opener'
import Moderation from '@/app/components/base/features/new-feature-panel/moderation'
import SpeechToText from '@/app/components/base/features/new-feature-panel/speech-to-text'
import TextToSpeech from '@/app/components/base/features/new-feature-panel/text-to-speech'
import FollowUp from '@/app/components/base/features/new-feature-panel/follow-up'
import Citation from '@/app/components/base/features/new-feature-panel/citation'

type Props = {
  show: boolean
  showAnnotation?: boolean
  isChatMode: boolean
  disabled: boolean
  onChange?: OnFeaturesChange
  onClose: () => void
}

const NewFeaturePanel = ({
  show,
  showAnnotation = false,
  isChatMode,
  onChange,
  onClose,
}: Props) => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.tts)
  const features = useFeatures(s => s.features)
  const featuresStore = useFeaturesStore()

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
    >
      <div className='grow flex flex-col h-full'>
        {/* header */}
        <div className='shrink-0 flex justify-between p-4 pb-3'>
          <div>
            <div className='text-text-primary system-xl-semibold'>{t('workflow.common.features')}</div>
            <div className='text-text-tertiary body-xs-regular'>{t('workflow.common.featuresDescription')}</div>
          </div>
          <div className='w-8 h-8 p-2 cursor-pointer' onClick={onClose}><RiCloseLine className='w-4 h-4 text-text-tertiary'/></div>
        </div>
        {/* list */}
        <div className='grow overflow-y-auto px-4 pb-4'>
          {!isChatMode && (
            <MoreLikeThis onChange={onChange} />
          )}
          {isChatMode && (
            <ConversationOpener onChange={onChange} />
          )}
          <Moderation onChange={onChange} />
          {isChatMode && speech2textDefaultModel && (
            <SpeechToText onChange={onChange} />
          )}
          {text2speechDefaultModel && (
            <TextToSpeech onChange={onChange} />
          )}
          {/* file upload ##TODO## */}
          <div className='group mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
            <div className='mb-2 flex items-center gap-2'>
              <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-blue-600'>
                <FolderUpload className='w-4 h-4 text-text-primary-on-surface' />
              </div>
              <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                File upload
              </div>
              <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.text2speech, value)} defaultValue={!!features.text2speech?.enabled} />
            </div>
          </div>
          {isChatMode && (
            <FollowUp onChange={onChange} />
          )}
          {isChatMode && (
            <Citation onChange={onChange} />
          )}
          {/* annotation reply ##TODO## */}
          {showAnnotation && (
            <div className='group mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
                  <MessageFast className='w-4 h-4 text-text-primary-on-surface' />
                </div>
                <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                  {t('appDebug.feature.annotation.title')}
                </div>
                <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.text2speech, value)} defaultValue={!!features.text2speech?.enabled} />
              </div>
              <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.annotation.description')}</div>
              <div className='group-hover:hidden pt-0.5 flex items-center gap-4'>
                <div className=''>
                  <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('appDebug.feature.annotation.scoreThreshold.title')}</div>
                  {/* <div className='text-text-secondary system-xs-regular'>{languageInfo?.name || '-'}</div> */}
                </div>
                <div className='w-px h-[27px] bg-divider-subtle rotate-12'></div>
                <div className=''>
                  <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('common.modelProvider.embeddingModel.key')}</div>
                  {/* <div className='text-text-secondary system-xs-regular'>{features.text2speech?.voice || '-'}</div> */}
                </div>
              </div>
              <div className='hidden group-hover:flex items-center justify-between'>
                <Button className='w-[178px]'>
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
            </div>
          )}
        </div>
      </div>
    </DialogWrapper>
  )
}

export default NewFeaturePanel
