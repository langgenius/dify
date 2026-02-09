import type { ContextGenerateChatMessage } from '../hooks/use-context-generate'
import type { VersionOption } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { TriggerProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import type { Model } from '@/types/app'
import { RiArrowDownSLine, RiRefreshLine, RiSendPlaneLine, RiSparklingLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import PromptEditor from '@/app/components/base/prompt-editor'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderI18nObject } from '@/i18n-config'
import { cn } from '@/utils/classnames'
import ChatView from './chat-view'

type LeftPanelProps = {
  isInitView: boolean
  isGenerating: boolean
  inputValue: string
  onInputChange: (value: string) => void
  onGenerate: () => void
  onReset: () => void
  suggestedQuestions: string[]
  hasFetchedSuggestions: boolean
  model: Model
  onModelChange: (newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => void
  onCompletionParamsChange: (newParams: FormValue) => void
  promptMessages: ContextGenerateChatMessage[]
  versionOptions: VersionOption[]
  currentVersionIndex: number
  onSelectVersion: (index: number) => void
  defaultAssistantMessage: string
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
}

const LeftPanel = ({
  isInitView,
  isGenerating,
  inputValue,
  onInputChange,
  onGenerate,
  onReset,
  suggestedQuestions,
  hasFetchedSuggestions,
  model,
  onModelChange,
  onCompletionParamsChange,
  promptMessages,
  versionOptions,
  currentVersionIndex,
  onSelectVersion,
  defaultAssistantMessage,
  availableVars,
  availableNodes,
}: LeftPanelProps) => {
  const { t, i18n } = useTranslation()
  const language = useMemo(() => (i18n.language || 'en-US').replace('-', '_'), [i18n.language])
  const shouldShowSuggestedSkeleton = isInitView && !hasFetchedSuggestions
  const suggestedSkeletonItems = useMemo(() => ([0, 1, 2]), [])

  const workflowNodesMap = useMemo(() => {
    return availableNodes.reduce<Record<string, Pick<Node['data'], 'title' | 'type' | 'height' | 'width' | 'position'>>>((acc, node) => {
      acc[node.id] = {
        title: node.data.title,
        type: node.data.type,
        height: node.data.height,
        width: node.data.width,
        position: node.data.position,
      }
      if (node.data.type === BlockEnum.Start) {
        acc.sys = {
          title: t('blocks.start', { ns: 'workflow' }),
          type: BlockEnum.Start,
        }
      }
      return acc
    }, {})
  }, [availableNodes, t])

  const workflowVariableBlock = useMemo(() => ({
    show: true,
    variables: availableVars,
    workflowNodesMap,
  }), [availableVars, workflowNodesMap])

  const renderModelTrigger = useCallback((params: TriggerProps) => {
    const label = params.currentModel?.label
      ? renderI18nObject(params.currentModel.label, language)
      : (params.currentModel?.model || params.modelId || model.name)
    const modelName = params.currentModel?.model || params.modelId || model.name
    return (
      <div
        className={cn(
          'flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-text-tertiary',
          params.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-state-base-hover',
        )}
      >
        <ModelIcon
          provider={params.currentProvider}
          modelName={modelName}
          className="!h-4 !w-4"
          iconClassName="!h-4 !w-4"
        />
        <span className="max-w-[200px] truncate font-medium text-text-tertiary">
          {label}
        </span>
        <RiArrowDownSLine className="h-3.5 w-3.5 text-text-tertiary" />
      </div>
    )
  }, [language, model.name])

  return (
    <div
      className={cn(
        'flex h-full w-[400px] shrink-0 flex-col border-r border-divider-regular bg-background-body',
        isInitView ? 'justify-center pb-20' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'bg-gradient-to-b from-background-body to-transparent backdrop-blur-[4px]',
          isInitView ? 'px-5 py-4' : 'px-4 pb-4 pt-3',
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="bg-gradient-to-r from-[rgba(11,165,236,0.95)] to-[rgba(21,90,239,0.95)] bg-clip-text text-transparent title-2xl-semi-bold">
              {t('nodes.tool.contextGenerate.title', { ns: 'workflow' })}
            </div>
            {isInitView && (
              <div className="mt-1 text-[13px] italic leading-4 text-text-tertiary">
                {t('nodes.tool.contextGenerate.subtitle', { ns: 'workflow' })}
              </div>
            )}
          </div>
          {!isInitView && (
            <ActionButton
              size="m"
              className={cn('!h-8 !w-8', isGenerating && 'pointer-events-none opacity-50')}
              onClick={onReset}
            >
              <RiRefreshLine className="h-4 w-4 text-text-tertiary" />
            </ActionButton>
          )}
        </div>
      </div>

      {isInitView
        ? (
            <div className="flex w-full flex-col gap-1 px-2">
              <div className="bg-gradient-to-b from-[rgba(255,255,255,0.01)] to-background-body px-2 pb-2 pt-3">
                <div className="flex h-[120px] flex-col justify-between overflow-hidden rounded-xl border-[0.5px] border-components-input-border-active bg-components-panel-bg shadow-shadow-shadow-5 backdrop-blur-[5px]">
                  <div className="flex min-h-[64px] px-3 pb-1 pt-2.5">
                    <PromptEditor
                      wrapperClassName="w-full"
                      className="text-sm leading-5 text-text-primary"
                      placeholder={t('nodes.tool.contextGenerate.initPlaceholder', { ns: 'workflow' })}
                      placeholderClassName="text-text-quaternary"
                      editable={!isGenerating}
                      value={inputValue}
                      workflowVariableBlock={workflowVariableBlock}
                      onChange={onInputChange}
                      onEnter={() => onGenerate()}
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
              <div className="flex flex-col gap-px px-2">
                <div className="flex items-center px-3 pb-2 pt-4">
                  <span className="text-xs font-semibold uppercase text-text-tertiary">
                    {t('nodes.tool.contextGenerate.suggestedQuestionsTitle', { ns: 'workflow' })}
                  </span>
                </div>
                <div className="flex flex-col gap-1 px-3">
                  {shouldShowSuggestedSkeleton && suggestedSkeletonItems.map(item => (
                    <SkeletonRow key={item} className="py-1">
                      <div className="h-4 w-4 rounded-sm bg-divider-subtle opacity-60" />
                      <SkeletonRectangle className="h-3 w-[260px]" />
                    </SkeletonRow>
                  ))}
                  {!shouldShowSuggestedSkeleton && suggestedQuestions.map((question, index) => (
                    <button
                      key={`${question}-${index}`}
                      type="button"
                      className="flex items-start gap-2 rounded-lg px-2 py-1 text-left text-sm text-text-secondary transition hover:bg-state-base-hover"
                      onClick={() => onInputChange(question)}
                    >
                      <RiSparklingLine className="mt-[2px] h-4 w-4 text-text-secondary" />
                      <span className="flex-1 whitespace-pre-wrap">{question}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        : (
            <ChatView
              promptMessages={promptMessages}
              versionOptions={versionOptions}
              currentVersionIndex={currentVersionIndex}
              onSelectVersion={onSelectVersion}
              defaultAssistantMessage={defaultAssistantMessage}
              isGenerating={isGenerating}
              inputValue={inputValue}
              onInputChange={onInputChange}
              onGenerate={onGenerate}
              model={model}
              onModelChange={onModelChange}
              onCompletionParamsChange={onCompletionParamsChange}
              renderModelTrigger={renderModelTrigger}
              workflowVariableBlock={workflowVariableBlock}
            />
          )}
    </div>
  )
}

export default LeftPanel
