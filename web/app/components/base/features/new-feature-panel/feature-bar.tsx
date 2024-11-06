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
    <div className='-translate-y-2 m-1 mt-0 px-2.5 py-2 pt-4 bg-util-colors-indigo-indigo-50 rounded-b-[10px] border-l border-b border-r border-components-panel-border-subtle'>
      {noFeatureEnabled && (
        <div className='flex items-end gap-1 cursor-pointer' onClick={() => onFeatureBarClick?.(true)}>
          <RiApps2AddLine className='w-3.5 h-3.5 text-text-accent' />
          <div className='text-text-accent body-xs-medium'>{t('appDebug.feature.bar.empty')}</div>
          <RiArrowRightLine className='w-3.5 h-3.5 text-text-accent' />
        </div>
      )}
      {!noFeatureEnabled && (
        <div className='flex items-center gap-2'>
          <div className='shrink-0 flex items-center gap-0.5'>
            {!!features.moreLikeThis?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moreLikeThis.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500'>
                  <RiSparklingFill className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.opening?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.conversationOpener.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500'>
                  <LoveMessage className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.moderation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moderation.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-text-success'>
                  <ContentModeration className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.speech2text?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.speechToText.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-violet-violet-600'>
                  <Microphone01 className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.text2speech?.enabled && (
              <VoiceSettings placementLeft={false} open={modalOpen && !disabled} onOpen={setModalOpen}>
                <Tooltip
                  popupContent={t('appDebug.feature.textToSpeech.title')}
                >
                  <div className={cn('shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-violet-violet-600', !disabled && 'cursor-pointer')}>
                    <TextToAudio className='w-3.5 h-3.5 text-text-primary-on-surface' />
                  </div>
                </Tooltip>
              </VoiceSettings>
            )}
            {showFileUpload && !!features.file?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.fileUpload.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-blue-600'>
                  <FolderUpload className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.suggested?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500'>
                  <VirtualAssistant className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.citation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.citation.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-warning-warning-500'>
                  <Citations className='w-4 h-4 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.annotationReply?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.annotation.title')}
              >
                <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
                  <MessageFast className='w-3.5 h-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
          </div>
          <div className='grow text-text-tertiary body-xs-regular'>{t('appDebug.feature.bar.enableText')}</div>
          <Button className='shrink-0' variant='ghost-accent' size='small' onClick={() => onFeatureBarClick?.(true)}>
            <div className='mx-1'>{t('appDebug.feature.bar.manage')}</div>
            <RiArrowRightLine className='w-3.5 h-3.5 text-text-accent' />
          </Button>
        </div>
      )}
    </div>
  )
}

export default FeatureBar
