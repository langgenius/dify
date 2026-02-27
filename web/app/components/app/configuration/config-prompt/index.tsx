'use client'
import type { FC } from 'react'
import type { PromptItem, PromptVariable } from '@/models/debug'
import type { AppModeEnum } from '@/types/app'
import {
  RiAddLine,
} from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AdvancedMessageInput from '@/app/components/app/configuration/config-prompt/advanced-prompt-input'
import Button from '@/app/components/base/button'
import { MAX_PROMPT_MESSAGE_LENGTH } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { PromptRole } from '@/models/debug'
import { ModelModeType } from '@/types/app'
import SimplePromptInput from './simple-prompt-input'

export type IPromptProps = {
  mode: AppModeEnum
  promptTemplate: string
  promptVariables: PromptVariable[]
  readonly?: boolean
  noTitle?: boolean
  gradientBorder?: boolean
  editorHeight?: number
  noResize?: boolean
  onChange?: (prompt: string, promptVariables: PromptVariable[]) => void
}

const Prompt: FC<IPromptProps> = ({
  mode,
  promptTemplate,
  promptVariables,
  noTitle,
  gradientBorder,
  readonly = false,
  editorHeight,
  noResize,
  onChange,
}) => {
  const { t } = useTranslation()

  const {
    isAdvancedMode,
    currentAdvancedPrompt,
    setCurrentAdvancedPrompt,
    modelModeType,
    dataSets,
    hasSetBlockStatus,
  } = useContext(ConfigContext)

  const handleMessageTypeChange = (index: number, role: PromptRole) => {
    const newPrompt = produce(currentAdvancedPrompt as PromptItem[], (draft) => {
      draft[index].role = role
    })
    setCurrentAdvancedPrompt(newPrompt)
  }

  const handleValueChange = (value: string, index?: number) => {
    if (modelModeType === ModelModeType.chat) {
      const newPrompt = produce(currentAdvancedPrompt as PromptItem[], (draft) => {
        draft[index as number].text = value
      })
      setCurrentAdvancedPrompt(newPrompt, true)
    }
    else {
      const prompt = currentAdvancedPrompt as PromptItem
      setCurrentAdvancedPrompt({
        ...prompt,
        text: value,
      }, true)
    }
  }

  const handleAddMessage = () => {
    const currentAdvancedPromptList = currentAdvancedPrompt as PromptItem[]
    if (currentAdvancedPromptList.length === 0) {
      setCurrentAdvancedPrompt([{
        role: PromptRole.system,
        text: '',
      }])
      return
    }
    const lastMessageType = currentAdvancedPromptList[currentAdvancedPromptList.length - 1]?.role
    const appendMessage = {
      role: lastMessageType === PromptRole.user ? PromptRole.assistant : PromptRole.user,
      text: '',
    }
    setCurrentAdvancedPrompt([...currentAdvancedPromptList, appendMessage])
  }

  const handlePromptDelete = (index: number) => {
    const currentAdvancedPromptList = currentAdvancedPrompt as PromptItem[]
    const newPrompt = produce(currentAdvancedPromptList, (draft) => {
      draft.splice(index, 1)
    })
    setCurrentAdvancedPrompt(newPrompt)
  }

  const isContextMissing = dataSets.length > 0 && !hasSetBlockStatus.context
  const [isHideContextMissTip, setIsHideContextMissTip] = React.useState(false)

  if (!isAdvancedMode) {
    return (
      <SimplePromptInput
        mode={mode}
        promptTemplate={promptTemplate}
        promptVariables={promptVariables}
        readonly={readonly}
        onChange={onChange}
        noTitle={noTitle}
        gradientBorder={gradientBorder}
        editorHeight={editorHeight}
        noResize={noResize}
      />
    )
  }

  return (
    <div>
      <div className="space-y-3">
        {modelModeType === ModelModeType.chat
          ? (
              (currentAdvancedPrompt as PromptItem[]).map((item, index) => (
                <AdvancedMessageInput
                  key={index}
                  isChatMode
                  type={item.role as PromptRole}
                  value={item.text}
                  onTypeChange={type => handleMessageTypeChange(index, type)}
                  canDelete={(currentAdvancedPrompt as PromptItem[]).length > 1}
                  onDelete={() => handlePromptDelete(index)}
                  onChange={value => handleValueChange(value, index)}
                  promptVariables={promptVariables}
                  isContextMissing={isContextMissing && !isHideContextMissTip}
                  onHideContextMissingTip={() => setIsHideContextMissTip(true)}
                  noResize={noResize}
                />
              ))
            )
          : (
              <AdvancedMessageInput
                type={(currentAdvancedPrompt as PromptItem).role as PromptRole}
                isChatMode={false}
                value={(currentAdvancedPrompt as PromptItem).text}
                onTypeChange={type => handleMessageTypeChange(0, type)}
                canDelete={false}
                onDelete={() => handlePromptDelete(0)}
                onChange={value => handleValueChange(value)}
                promptVariables={promptVariables}
                isContextMissing={isContextMissing && !isHideContextMissTip}
                onHideContextMissingTip={() => setIsHideContextMissTip(true)}
                noResize={noResize}
              />
            )}
      </div>
      {(modelModeType === ModelModeType.chat && (currentAdvancedPrompt as PromptItem[]).length < MAX_PROMPT_MESSAGE_LENGTH) && (
        <Button
          onClick={handleAddMessage}
          className="mt-3 w-full"
        >
          <RiAddLine className="mr-2 h-4 w-4" />
          <div>{t('promptMode.operation.addMessage', { ns: 'appDebug' })}</div>
        </Button>
      )}
    </div>
  )
}

export default React.memo(Prompt)
