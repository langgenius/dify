import type { ReactNode } from 'react'
import type { ContextGenerateChatMessage } from '../hooks/use-context-generate'
import type { VersionOption } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { Model } from '@/types/app'
import { RiArrowRightLine, RiSendPlaneLine } from '@remixicon/react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { CodeAssistant } from '@/app/components/base/icons/src/vender/line/general'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { cn } from '@/utils/classnames'

type ChatViewProps = {
  promptMessages: ContextGenerateChatMessage[]
  versionOptions: VersionOption[]
  currentVersionIndex: number
  onSelectVersion: (index: number) => void
  defaultAssistantMessage: string
  isGenerating: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onGenerate: () => void
  model: Model
  onModelChange: (newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => void
  onCompletionParamsChange: (newParams: FormValue) => void
  renderModelTrigger: (params: TriggerProps) => ReactNode
}

const ChatView = ({
  promptMessages,
  versionOptions,
  currentVersionIndex,
  onSelectVersion,
  defaultAssistantMessage,
  isGenerating,
  inputValue,
  onInputChange,
  onGenerate,
  model,
  onModelChange,
  onCompletionParamsChange,
  renderModelTrigger,
}: ChatViewProps) => {
  const { t } = useTranslation()
  const chatListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatListRef.current)
      return
    if (promptMessages.length === 0 && !isGenerating)
      return
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight
  }, [isGenerating, promptMessages.length])

  const assistantVersionMap = useMemo(() => {
    let assistantIndex = 0
    return promptMessages.map((message) => {
      if (message.role !== 'assistant')
        return null
      const versionMeta = versionOptions[assistantIndex] ?? null
      assistantIndex += 1
      return versionMeta
    })
  }, [promptMessages, versionOptions])

  return (
    <>
      <div
        ref={chatListRef}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        <div className="flex w-full flex-col items-end gap-4 pt-3">
          {promptMessages.map((message, index) => {
            const versionMeta = assistantVersionMap[index]
            const isSelected = versionMeta?.index === currentVersionIndex
            const assistantContent = message.content || defaultAssistantMessage
            const messageKey = message.id || `${message.role}-${index}`
            return (
              <div
                key={messageKey}
                className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {message.role === 'user'
                  ? (
                      <div className="max-w-[320px] whitespace-pre-wrap rounded-xl bg-util-colors-blue-brand-blue-brand-500 px-3 py-2 text-sm leading-5 text-text-primary-on-surface">
                        {message.content}
                      </div>
                    )
                  : (
                      <div className="flex w-full flex-col items-start gap-2">
                        <div className="whitespace-pre-wrap px-2 text-sm leading-5 text-text-primary">
                          {assistantContent}
                        </div>
                        {versionMeta && (
                          <button
                            type="button"
                            className={cn(
                              'flex min-h-[40px] w-full items-center gap-2 rounded-[12px] border-[0.5px] bg-components-card-bg px-3 py-2 text-left',
                              isSelected
                                ? 'border-[1.5px] border-components-option-card-option-selected-border'
                                : 'border-components-panel-border-subtle',
                            )}
                            onClick={() => onSelectVersion(versionMeta.index)}
                          >
                            <div className="flex h-4 w-4 items-center justify-center rounded-[5px] border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-[2px] shadow-xs">
                              <CodeAssistant className="h-3 w-3 text-text-primary-on-surface" />
                            </div>
                            <span className="flex-1 text-[13px] font-medium text-text-primary">
                              {versionMeta.label}
                            </span>
                            <RiArrowRightLine className="h-4 w-4 text-text-tertiary" />
                          </button>
                        )}
                      </div>
                    )}
              </div>
            )
          })}
          {isGenerating && (
            <div className="flex w-full items-center gap-2 rounded-xl bg-background-gradient-bg-fill-chat-bubble-bg-2 px-2 py-2 text-xs text-text-secondary">
              <LoadingAnim type="text" />
              <span>{t('nodes.tool.contextGenerate.generating', { ns: 'workflow' })}</span>
            </div>
          )}
        </div>
      </div>
      <div className="bg-gradient-to-b from-[rgba(255,255,255,0.01)] to-background-body px-1 pb-1 pt-3">
        <div className="flex min-h-[112px] flex-col justify-between overflow-hidden rounded-xl border-[0.5px] border-components-input-border-active bg-components-panel-bg shadow-shadow-shadow-5 backdrop-blur-[5px]">
          <div className="flex min-h-[64px] px-3 pb-1 pt-2.5">
            <textarea
              value={inputValue}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  onGenerate()
                }
              }}
              placeholder={t('nodes.tool.contextGenerate.inputPlaceholder', { ns: 'workflow' }) as string}
              className="w-full resize-none bg-transparent text-sm leading-5 text-text-primary placeholder:text-text-quaternary focus:outline-none"
              disabled={isGenerating}
              rows={2}
            />
          </div>
          <div className="flex items-end gap-2 p-2">
            <ModelParameterModal
              popupClassName="!w-[520px]"
              portalToFollowElemContentClassName="z-[1000]"
              isAdvancedMode={true}
              provider={model.provider}
              completionParams={model.completion_params}
              modelId={model.name}
              setModel={onModelChange}
              onCompletionParamsChange={onCompletionParamsChange}
              hideDebugWithMultipleModel
              renderTrigger={renderModelTrigger}
            />
            <Button
              variant="primary"
              size="small"
              className="ml-auto !h-8 !w-8 shrink-0 !rounded-lg !px-0"
              disabled={!inputValue.trim() || isGenerating}
              onClick={onGenerate}
            >
              <RiSendPlaneLine className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

export default ChatView
