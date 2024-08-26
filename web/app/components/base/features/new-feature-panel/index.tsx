import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import {
  RiCloseLine,
  RiQuestionLine,
  RiSparklingFill,
} from '@remixicon/react'
import {
  Citations,
  Microphone01,
  VirtualAssistant,
} from '@/app/components/base/icons/src/vender/features'
import DialogWrapper from '@/app/components/base/features/new-feature-panel/dialog-wrapper'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  show: boolean
  isChatMode: boolean
  disabled: boolean
  onChange?: OnFeaturesChange
  onClose: () => void
}

const NewFeaturePanel = ({ show, isChatMode, onChange, onClose }: Props) => {
  const { t } = useTranslation()
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
          {/* more like this */}
          {!isChatMode && (
            <div className='mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500'>
                  <RiSparklingFill className='w-4 h-4 text-text-primary-on-surface' />
                </div>
                <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                  {t('appDebug.feature.moreLikeThis.title')}
                  <Tooltip
                    htmlContent={
                      <div className='w-[180px]'>
                        {t('appDebug.feature.moreLikeThis.tip')}
                      </div>
                    }
                    selector='feature-more-like-this'
                  >
                    <div className='ml-0.5 p-px'><RiQuestionLine className='w-3.5 h-3.5 text-text-quaternary' /></div>
                  </Tooltip>
                </div>
                <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.moreLikeThis, value)} defaultValue={!!features.moreLikeThis?.enabled} />
              </div>
              <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.moreLikeThis.description')}</div>
            </div>
          )}
          {/* speech to text */}
          {isChatMode && (
            <div className='mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-violet-violet-600'>
                  <Microphone01 className='w-4 h-4 text-text-primary-on-surface' />
                </div>
                <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                  {t('appDebug.feature.speechToText.title')}
                </div>
                <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.speech2text, value)} defaultValue={!!features.speech2text?.enabled} />
              </div>
              <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.speechToText.description')}</div>
            </div>
          )}
          {/* follow up */}
          {isChatMode && (
            <div className='mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500'>
                  <VirtualAssistant className='w-4 h-4 text-text-primary-on-surface' />
                </div>
                <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                  {t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
                </div>
                <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.suggested, value)} defaultValue={!!features.suggested?.enabled} />
              </div>
              <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.description')}</div>
            </div>
          )}
          {/* citations & attributions */}
          {isChatMode && (
            <div className='mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-warning-warning-500'>
                  <Citations className='w-4 h-4 text-text-primary-on-surface' />
                </div>
                <div className='grow flex items-center text-text-secondary system-sm-semibold'>
                  {t('appDebug.feature.citation.title')}
                </div>
                <Switch className='shrink-0' onChange={value => handleChange(FeatureEnum.citation, value)} defaultValue={!!features.citation?.enabled} />
              </div>
              <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.citation.description')}</div>
            </div>
          )}
        </div>
      </div>
    </DialogWrapper>
  )
}

export default NewFeaturePanel
