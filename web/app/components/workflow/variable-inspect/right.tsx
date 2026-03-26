import type { CurrentVarInInspect } from './types'
import type { VarInspectValue } from './value-types'
import type { GenRes } from '@/service/debug'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { AppModeEnum } from '@/types/app'
import { VarInInspectType } from '@/types/workflow'
import GetCodeGeneratorResModal from '../../app/configuration/config/code-generator/get-code-generator-res'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '../../base/prompt-editor/plugins/update-block'
import { useNodesInteractions, useToolIcon } from '../hooks'
import { useHooksStore } from '../hooks-store'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import useNodeCrud from '../nodes/_base/hooks/use-node-crud'
import useNodeInfo from '../nodes/_base/hooks/use-node-info'
import { CodeLanguage } from '../nodes/code/types'
import { BlockEnum } from '../types'
import Empty from './empty'
import useInspectShell from './hooks/use-inspect-shell'
import { formatVarTypeLabel } from './utils'
import ValueContent from './value-content'

type Props = {
  nodeId: string
  currentNodeVar?: CurrentVarInInspect
  isValueFetching?: boolean
}

export default function Right({
  nodeId,
  currentNodeVar,
  isValueFetching,
}: Props) {
  const { t } = useTranslation()
  const { isNarrow, onClose, openLeftPane } = useInspectShell()
  const toolIcon = useToolIcon(currentNodeVar?.nodeData)
  const currentVar = currentNodeVar?.var
  const currentNodeType = currentNodeVar?.nodeType
  const currentNodeTitle = currentNodeVar?.title
  const currentNodeId = currentNodeVar?.nodeId
  const isTruncated = !!currentVar?.is_truncated
  const fullContent = currentVar?.full_content
  const isAgentAliasVar = currentVar?.name?.startsWith('@')
  const displayVarName = isAgentAliasVar ? currentVar?.name?.slice(1) : currentVar?.name

  const {
    resetConversationVar,
    resetToLastRunVar,
    editInspectVarValue,
  } = useCurrentVars()

  const handleValueChange = (varId: string, value: VarInspectValue) => {
    if (!currentNodeVar || !currentVar)
      return
    editInspectVarValue(currentNodeVar.nodeId, varId, value)
  }

  const resetValue = () => {
    if (!currentNodeVar || !currentVar)
      return
    resetToLastRunVar(currentNodeVar.nodeId, currentVar.id)
  }

  const handleClear = () => {
    if (!currentNodeVar || !currentVar)
      return
    resetConversationVar(currentVar.id)
  }

  const getCopyContent = () => {
    const value = currentVar?.value
    if (value === null || value === undefined)
      return ''
    if (typeof value === 'object')
      return JSON.stringify(value)
    return String(value)
  }

  const configsMap = useHooksStore(s => s.configsMap)
  const { eventEmitter } = useEventEmitterContextContext()
  const { handleNodeSelect } = useNodesInteractions()
  const { node } = useNodeInfo(nodeId)
  const { setInputs } = useNodeCrud(nodeId, node?.data)
  const blockType = node?.data?.type
  const isCodeBlock = blockType === BlockEnum.Code
  const canShowPromptGenerator = [BlockEnum.LLM, BlockEnum.Code].includes(blockType)
  const currentPrompt = useMemo(() => {
    if (!canShowPromptGenerator)
      return ''
    if (blockType === BlockEnum.LLM)
      return node?.data?.prompt_template?.text || node?.data?.prompt_template?.[0].text
    if (blockType === BlockEnum.Code)
      return node?.data?.code
  }, [blockType, canShowPromptGenerator, node?.data?.code, node?.data?.prompt_template])

  const [isShowPromptGenerator, {
    setTrue: doShowPromptGenerator,
    setFalse: handleHidePromptGenerator,
  }] = useBoolean(false)
  const handleShowPromptGenerator = useCallback(() => {
    handleNodeSelect(nodeId)
    doShowPromptGenerator()
  }, [doShowPromptGenerator, handleNodeSelect, nodeId])

  const handleUpdatePrompt = useCallback((res: GenRes) => {
    const newInputs = produce(node?.data, (draft: any) => {
      switch (blockType) {
        case BlockEnum.LLM:
          if (draft?.prompt_template) {
            if (Array.isArray(draft.prompt_template))
              draft.prompt_template[0].text = res.modified
            else
              draft.prompt_template.text = res.modified
          }
          break
        case BlockEnum.Code:
          draft.code = res.modified
          break
      }
    })
    setInputs(newInputs)
    eventEmitter?.emit({
      type: PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER,
      instanceId: `${nodeId}-chat-workflow-llm-prompt-editor`,
      payload: res.modified,
    })
    handleHidePromptGenerator()
  }, [eventEmitter, setInputs, blockType, nodeId, node?.data, handleHidePromptGenerator])

  const schemaType = currentVar?.schemaType
  const valueType = currentVar?.value_type
  const valueTypeLabel = formatVarTypeLabel(valueType)
  const shouldShowSchemaType = !!schemaType
    && schemaType !== valueType
    && schemaType !== valueTypeLabel
  const displaySchemaType = shouldShowSchemaType ? (`(${schemaType})`) : ''

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {isNarrow
            ? (
                <ActionButton className="shrink-0" onClick={openLeftPane} aria-label="Open menu">
                  <span className="i-ri-menu-line h-4 w-4" aria-hidden="true" />
                </ActionButton>
              )
            : null}
          <div className="flex w-0 grow items-center gap-1">
            {currentVar && (
              <>
                {currentNodeType
                  && ([VarInInspectType.environment, VarInInspectType.conversation, VarInInspectType.system] as const).includes(
                    currentNodeType as typeof VarInInspectType.environment | typeof VarInInspectType.conversation | typeof VarInInspectType.system,
                  ) && (
                  <VariableIconWithColor
                    variableCategory={currentNodeType as VarInInspectType}
                    className="size-4"
                  />
                )}
                {currentNodeType
                  && currentNodeType !== VarInInspectType.environment
                  && currentNodeType !== VarInInspectType.conversation
                  && currentNodeType !== VarInInspectType.system
                  && (
                    <>
                      <BlockIcon
                        className="shrink-0"
                        type={currentNodeType as BlockEnum}
                        size="xs"
                        toolIcon={toolIcon}
                      />
                      <div className="shrink-0 text-text-secondary system-sm-regular">{currentNodeTitle}</div>
                      <div className="shrink-0 text-text-quaternary system-sm-regular">/</div>
                    </>
                  )}
                <div title={displayVarName} className="truncate text-text-secondary system-sm-semibold">{displayVarName}</div>
                <div className="ml-1 shrink-0 space-x-2 text-text-tertiary system-xs-medium">
                  <span>{`${valueTypeLabel}${displaySchemaType}`}</span>
                  {isTruncated && (
                    <>
                      <span>·</span>
                      <span>
                        {((fullContent?.size_bytes || 0) / 1024 / 1024).toFixed(1)}
                        MB
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {currentVar && (
              <>
                {canShowPromptGenerator && (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <button
                          type="button"
                          className="cursor-pointer rounded-md p-1 hover:bg-state-accent-active"
                          onClick={handleShowPromptGenerator}
                        >
                          <span className="i-ri-sparkling-fill size-4 text-components-input-border-active-prompt-1" aria-hidden="true" />
                        </button>
                      )}
                    />
                    <TooltipContent>{t('generate.optimizePromptTooltip', { ns: 'appDebug' })}</TooltipContent>
                  </Tooltip>
                )}
                {isTruncated && (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span className="inline-flex">
                          <ActionButton
                            onClick={() => window.open(fullContent?.download_url, '_blank')}
                            aria-label={t('debug.variableInspect.exportToolTip', { ns: 'workflow' })}
                          >
                            <span className="i-ri-file-download-fill size-4" aria-hidden="true" />
                          </ActionButton>
                        </span>
                      )}
                    />
                    <TooltipContent>{t('debug.variableInspect.exportToolTip', { ns: 'workflow' })}</TooltipContent>
                  </Tooltip>
                )}
                {!isTruncated && currentVar.edited && (
                  <Badge>
                    <span className="ml-[2.5px] mr-[4.5px] h-[3px] w-[3px] rounded bg-text-accent-secondary"></span>
                    <span className="system-2xs-semibold-uppercase">{t('debug.variableInspect.edited', { ns: 'workflow' })}</span>
                  </Badge>
                )}
                {!isTruncated && currentVar.edited && currentVar.type !== VarInInspectType.conversation && (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span className="inline-flex">
                          <ActionButton onClick={resetValue}>
                            <span className="i-ri-arrow-go-back-line h-4 w-4" aria-hidden="true" />
                          </ActionButton>
                        </span>
                      )}
                    />
                    <TooltipContent>{t('debug.variableInspect.reset', { ns: 'workflow' })}</TooltipContent>
                  </Tooltip>
                )}
                {!isTruncated && currentVar.edited && currentVar.type === VarInInspectType.conversation && (
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span className="inline-flex">
                          <ActionButton onClick={handleClear}>
                            <span className="i-ri-arrow-go-back-line h-4 w-4" aria-hidden="true" />
                          </ActionButton>
                        </span>
                      )}
                    />
                    <TooltipContent>{t('debug.variableInspect.resetConversationVar', { ns: 'workflow' })}</TooltipContent>
                  </Tooltip>
                )}
                {currentVar.value_type !== 'secret' && (
                  <CopyFeedback content={getCopyContent()} />
                )}
              </>
            )}
          </div>
        </div>
        <ActionButton className="shrink-0" onClick={onClose} aria-label="Close">
          <span className="i-ri-close-line h-4 w-4" aria-hidden="true" />
        </ActionButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grow p-2">
          {!currentVar && <Empty />}
          {isValueFetching && (
            <div className="flex h-full items-center justify-center">
              <Loading />
            </div>
          )}
          {currentVar && currentNodeId && !isValueFetching && (
            <ValueContent
              key={`${currentNodeId}-${currentVar.id}`}
              currentVar={currentVar}
              handleValueChange={handleValueChange}
              isTruncated={!!isTruncated}
            />
          )}
        </div>
        {isShowPromptGenerator && (
          isCodeBlock
            ? (
                <GetCodeGeneratorResModal
                  isShow
                  mode={AppModeEnum.CHAT}
                  onClose={handleHidePromptGenerator}
                  flowId={configsMap?.flowId || ''}
                  nodeId={nodeId}
                  currentCode={currentPrompt}
                  codeLanguages={node?.data?.code_languages || CodeLanguage.python3}
                  onFinished={handleUpdatePrompt}
                />
              )
            : (
                <GetAutomaticResModal
                  mode={AppModeEnum.CHAT}
                  isShow
                  onClose={handleHidePromptGenerator}
                  onFinished={handleUpdatePrompt}
                  flowId={configsMap?.flowId || ''}
                  nodeId={nodeId}
                  currentPrompt={currentPrompt}
                />
              )
        )}
      </div>
    </>
  )
}
