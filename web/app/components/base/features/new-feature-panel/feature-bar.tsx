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
    <div className='m-1 mt-0 -translate-y-2 rounded-b-[10px] border-b border-l border-r border-components-panel-border-subtle bg-util-colors-indigo-indigo-50 px-2.5 py-2 pt-4'>
      {noFeatureEnabled && (
        <div className='flex cursor-pointer items-end gap-1' onClick={() => onFeatureBarClick?.(true)}>
          <RiApps2AddLine className='h-3.5 w-3.5 text-text-accent' />
          <div className='body-xs-medium text-text-accent'>{t('appDebug.feature.bar.empty')}</div>
          <RiArrowRightLine className='h-3.5 w-3.5 text-text-accent' />
        </div>
      )}
      {!noFeatureEnabled && (
        <div className='flex items-center gap-2'>
          <div className='flex shrink-0 items-center gap-0.5'>
            {!!features.moreLikeThis?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moreLikeThis.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs'>
                  <RiSparklingFill className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.opening?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.conversationOpener.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs'>
                  <LoveMessage className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.moderation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.moderation.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-text-success p-1 shadow-xs'>
                  <ContentModeration className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.speech2text?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.speechToText.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-600 p-1 shadow-xs'>
                  <Microphone01 className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.text2speech?.enabled && (
              <VoiceSettings placementLeft={false} open={modalOpen && !disabled} onOpen={setModalOpen}>
                <Tooltip
                  popupContent={t('appDebug.feature.textToSpeech.title')}
                >
                  <div className={cn('shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-600 p-1 shadow-xs', !disabled && 'cursor-pointer')}>
                    <TextToAudio className='h-3.5 w-3.5 text-text-primary-on-surface' />
                  </div>
                </Tooltip>
              </VoiceSettings>
            )}
            {showFileUpload && !!features.file?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.fileUpload.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-600 p-1 shadow-xs'>
                  <FolderUpload className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {!!features.suggested?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.suggestedQuestionsAfterAnswer.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs'>
                  <VirtualAssistant className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.citation?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.citation.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-warning-warning-500 p-1 shadow-xs'>
                  <Citations className='h-4 w-4 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
            {isChatMode && !!features.annotationReply?.enabled && (
              <Tooltip
                popupContent={t('appDebug.feature.annotation.title')}
              >
                <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-600 p-1 shadow-xs'>
                  <MessageFast className='h-3.5 w-3.5 text-text-primary-on-surface' />
                </div>
              </Tooltip>
            )}
          </div>
          <div className='body-xs-regular grow text-text-tertiary'>{t('appDebug.feature.bar.enableText')}</div>
          <Button className='shrink-0' variant='ghost-accent' size='small' onClick={() => onFeatureBarClick?.(true)}>
            <div className='mx-1'>{t('appDebug.feature.bar.manage')}</div>
            <RiArrowRightLine className='h-3.5 w-3.5 text-text-accent' />
          </Button>
        </div>
      )}
    </div>
  )
}

export default FeatureBar
