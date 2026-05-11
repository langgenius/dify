import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import { DrawerCloseButton } from '@langgenius/dify-ui/drawer'
import { useTranslation } from 'react-i18next'
import AnnotationReply from '@/app/components/base/features/new-feature-panel/annotation-reply'

import Citation from '@/app/components/base/features/new-feature-panel/citation'
import ConversationOpener from '@/app/components/base/features/new-feature-panel/conversation-opener'
import { FeaturePanelDrawer } from '@/app/components/base/features/new-feature-panel/feature-panel-drawer'
import FileUpload from '@/app/components/base/features/new-feature-panel/file-upload'
import FollowUp from '@/app/components/base/features/new-feature-panel/follow-up'
import ImageUpload from '@/app/components/base/features/new-feature-panel/image-upload'
import Moderation from '@/app/components/base/features/new-feature-panel/moderation'
import MoreLikeThis from '@/app/components/base/features/new-feature-panel/more-like-this'
import SpeechToText from '@/app/components/base/features/new-feature-panel/speech-to-text'
import TextToSpeech from '@/app/components/base/features/new-feature-panel/text-to-speech'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

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
  const { data: speech2textDefaultModel } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.tts)

  return (
    <FeaturePanelDrawer
      show={show}
      onClose={onClose}
      inWorkflow={inWorkflow}
    >
      <div className="flex h-full grow flex-col">
        {/* header */}
        <div className="flex shrink-0 justify-between p-4 pb-3">
          <div>
            <div className="system-xl-semibold text-text-primary">{t('common.features', { ns: 'workflow' })}</div>
            <div className="body-xs-regular text-text-tertiary">{t('common.featuresDescription', { ns: 'workflow' })}</div>
          </div>
          <DrawerCloseButton
            aria-label={t('operation.close', { ns: 'common' })}
            className="h-8 w-8 p-2"
          />
        </div>
        {/* list */}
        <div className="grow basis-0 overflow-y-auto px-4 pb-4">
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
    </FeaturePanelDrawer>
  )
}

export default NewFeaturePanel
