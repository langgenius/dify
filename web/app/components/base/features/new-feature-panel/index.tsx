import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiInformation2Fill } from '@remixicon/react'
import DialogWrapper from '@/app/components/base/features/new-feature-panel/dialog-wrapper'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { OnFeaturesChange } from '@/app/components/base/features/types'

import MoreLikeThis from '@/app/components/base/features/new-feature-panel/more-like-this'
import ConversationOpener from '@/app/components/base/features/new-feature-panel/conversation-opener'
import FollowUp from '@/app/components/base/features/new-feature-panel/follow-up'
import SpeechToText from '@/app/components/base/features/new-feature-panel/speech-to-text'
import TextToSpeech from '@/app/components/base/features/new-feature-panel/text-to-speech'
import FileUpload from '@/app/components/base/features/new-feature-panel/file-upload'
import Citation from '@/app/components/base/features/new-feature-panel/citation'
import ImageUpload from '@/app/components/base/features/new-feature-panel/image-upload'
import Moderation from '@/app/components/base/features/new-feature-panel/moderation'
import AnnotationReply from '@/app/components/base/features/new-feature-panel/annotation-reply'
import type { PromptVariable } from '@/models/debug'
import type { InputVar } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'

type Props = {
  show: boolean
  isChatMode: boolean
  disabled: boolean
  onChange?: OnFeaturesChange
  onClose: () => void
  inWorkflow?: boolean
  showFileUpload?: boolean
  promptVariables?: PromptVariable[]
  workflowVariables?: InputVar[]
  onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
}

const NewFeaturePanel = ({
  show,
  isChatMode,
  disabled,
  onChange,
  onClose,
  inWorkflow = true,
  showFileUpload = true,
  promptVariables,
  workflowVariables,
  onAutoAddPromptVariable,
}: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.tts)

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      inWorkflow={inWorkflow}
    >
      <div className='flex h-full grow flex-col'>
        {/* header */}
        <div className='flex shrink-0 justify-between p-4 pb-3'>
          <div>
            <div className='system-xl-semibold text-text-primary'>{t('workflow.common.features')}</div>
            <div className='body-xs-regular text-text-tertiary'>{t('workflow.common.featuresDescription')}</div>
          </div>
          <div className='h-8 w-8 cursor-pointer p-2' onClick={onClose}><RiCloseLine className='h-4 w-4 text-text-tertiary'/></div>
        </div>
        {/* list */}
        <div className='grow basis-0 overflow-y-auto px-4 pb-4'>
          {showFileUpload && (
            <div className='relative mb-1 rounded-xl border border-components-panel-border p-2 shadow-xs'>
              <div className='absolute left-0 top-0 h-full w-full rounded-xl opacity-40' style={{ background: 'linear-gradient(92deg, rgba(11, 165, 236, 0.25) 18.12%, rgba(255, 255, 255, 0.00) 167.31%)' }}></div>
              <div className='relative flex h-full w-full items-start'>
                <div className='mr-0.5 shrink-0 p-0.5'>
                  <RiInformation2Fill className='h-5 w-5 text-text-accent' />
                </div>
                <div className='system-xs-medium p-1 text-text-primary'>
                  <span>{isChatMode ? t('workflow.common.fileUploadTip') : t('workflow.common.ImageUploadLegacyTip')}</span>
                  <a
                    className='text-text-accent'
                    href={docLink('/guides/workflow/bulletin')}
                    target='_blank' rel='noopener noreferrer'
                  >{t('workflow.common.featuresDocLink')}</a>
                </div>
              </div>
            </div>
          )}
          {!isChatMode && !inWorkflow && (
            <MoreLikeThis disabled={disabled} onChange={onChange} />
          )}
          {isChatMode && (
            <ConversationOpener
              disabled={disabled}
              onChange={onChange}
              promptVariables={promptVariables}
              workflowVariables={workflowVariables}
              onAutoAddPromptVariable={onAutoAddPromptVariable}
            />
          )}
          {isChatMode && (
            <FollowUp disabled={disabled} onChange={onChange} />
          )}
          {text2speechDefaultModel && (isChatMode || !inWorkflow) && (
            <TextToSpeech disabled={disabled} onChange={onChange} />
          )}
          {isChatMode && speech2textDefaultModel && (
            <SpeechToText disabled={disabled} onChange={onChange} />
          )}
          {showFileUpload && isChatMode && <FileUpload disabled={disabled} onChange={onChange} />}
          {showFileUpload && !isChatMode && <ImageUpload disabled={disabled} onChange={onChange} />}
          {isChatMode && (
            <Citation disabled={disabled} onChange={onChange} />
          )}
          {(isChatMode || !inWorkflow) && <Moderation disabled={disabled} onChange={onChange} />}
          {!inWorkflow && isChatMode && (
            <AnnotationReply disabled={disabled} onChange={onChange} />
          )}
        </div>
      </div>
    </DialogWrapper>
  )
}

export default NewFeaturePanel
