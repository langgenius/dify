import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
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

type Props = {
  show: boolean
  isChatMode: boolean
  disabled: boolean
  onChange?: OnFeaturesChange
  onClose: () => void
  inWorkflow?: boolean
  showFileUpload?: boolean
  promptVariables?: PromptVariable[]
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
  onAutoAddPromptVariable,
}: Props) => {
  const { t } = useTranslation()
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.tts)

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      inWorkflow={inWorkflow}
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
        <div className='grow basis-0 overflow-y-auto px-4 pb-4'>
          {!isChatMode && !inWorkflow && (
            <MoreLikeThis disabled={disabled} onChange={onChange} />
          )}
          {isChatMode && (
            <ConversationOpener
              disabled={disabled}
              onChange={onChange}
              promptVariables={promptVariables}
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
