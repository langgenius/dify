import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiApps2AddLine, RiArrowRightLine, RiSparklingFill } from '@remixicon/react'
import { Citations, ContentModeration, FolderUpload, LoveMessage, MessageFast, Microphone01, TextToAudio, VirtualAssistant } from '@/app/components/base/icons/src/vender/features'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import VoiceSettings from '@/app/components/base/features/new-feature-panel/text-to-speech/voice-settings'
import { useFeatures } from '@/app/components/base/features/hooks'
import cn from '@/utils/classnames'

type Props = {
  isChatMode?: boolean
  showFileUpload?: boolean
  disabled?: boolean
  onFeatureBarClick?: (state: boolean) => void
}

const FeatureBar = ({
  isChatMode = true,
  showFileUpload = true,
  disabled,
  onFeatureBarClick,
}: Props) => {
  const { t } = useTranslation()
  const features = useFeatures(s => s.features)
  const [modalOpen, setModalOpen] = useState(false)

  const noFeatureEnabled = useMemo(() => {
    // completion app citation is always true but not enabled for setting
    const data = {
      ...features,
      citation: { enabled: isChatMode ? features.citation?.enabled : false },
      file: showFileUpload ? features.file! : { enabled: false },
    }
    return !Object.values(data).some(f => f.enabled)
  }, [features, isChatMode, showFileUpload])

  return (
    <div className='bg-util-colors-indigo-indigo-50 border-components-panel-border-subtle m-1 mt-0 -translate-y-2 rounded-b-[10px] border-b border-l border-r px-2.5 py-2 pt-4'>
      {noFeatureEnabled && (
        <div className='flex cursor-pointer items-end gap-1' onClick={() => onFeatureBarClick?.(true)}>
          <RiApps2AddLine className='text-text-accent h-3.5 w-3.5' />
          <div className='text-text-accent body-xs-medium'>{t('appDebug.feature.bar.empty')}</div>
          <RiArrowRightLine className='text-text-accent h-3.5 w-3.5' />
        </div>
      )}
      {!noFeatureEnabled && (
        <div className='flex items-center gap-2'>
          <div className='flex shrink-0 items-center gap-0.5'>
            {!!features.moreLikeThis?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moreLikeThis.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <RiSparklingFill className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {!!features.opening?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.conversationOpener.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <LoveMessage className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {!!features.moderation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moderation.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-text-success shrink-0 rounded-lg border-[0.5px] p-1'>
                  <ContentModeration className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {!!features.speech2text?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.speechToText.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-violet-violet-600 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <Microphone01 className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {!!features.text2speech?.enabled && (
              <VoiceSettings placementLeft={false} open={modalOpen && !disabled} onOpen={setModalOpen}>
                <Tooltip
                  popupContent={t('appDebug.feature.textToSpeech.title')}
                >
                  <div className={cn('border-divider-subtle shadow-xs bg-util-colors-violet-violet-600 shrink-0 rounded-lg border-[0.5px] p-1', !disabled && 'cursor-pointer')}>
                    <TextToAudio className='text-text-primary-on-surface h-3.5 w-3.5' />
                  </div>
                </Tooltip>
              </VoiceSettings>
            )}
            {showFileUpload && !!features.file?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.fileUpload.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-blue-blue-600 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <FolderUpload className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {!!features.suggested?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <VirtualAssistant className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.citation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.citation.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-warning-warning-500 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <Citations className='text-text-primary-on-surface h-4 w-4' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.annotationReply?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.annotation.title')}
              >
                <div className='border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600 shrink-0 rounded-lg border-[0.5px] p-1'>
                  <MessageFast className='text-text-primary-on-surface h-3.5 w-3.5' />
                </div>
              </Tooltip>
            )}
          </div>
          <div className='text-text-tertiary body-xs-regular grow'>{t('appDebug.feature.bar.enableText')}</div>
          <Button className='shrink-0' variant='ghost-accent' size='small' onClick={() => onFeatureBarClick?.(true)}>
            <div className='mx-1'>{t('appDebug.feature.bar.manage')}</div>
            <RiArrowRightLine className='text-text-accent h-3.5 w-3.5' />
          </Button>
        </div>
      )}
    </div>
  )
}

export default FeatureBar
