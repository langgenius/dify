import type { currentVarType } from './panel'
import type { GenRes } from '@/service/debug'
import {
  RiArrowGoBackLine,
  RiCloseLine,
  RiFileDownloadFill,
  RiMenuLine,
  RiSparklingFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import GetAutomaticResModal from '@/app/components/app/configuration/config/automatic/get-automatic-res'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { AppModeEnum } from '@/types/app'
import { VarInInspectType } from '@/types/workflow'
import { cn } from '@/utils/classnames'
import GetCodeGeneratorResModal from '../../app/configuration/config/code-generator/get-code-generator-res'
import { PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER } from '../../base/prompt-editor/plugins/update-block'
import { useNodesInteractions, useToolIcon } from '../hooks'
import { useHooksStore } from '../hooks-store'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import useNodeCrud from '../nodes/_base/hooks/use-node-crud'
import useNodeInfo from '../nodes/_base/hooks/use-node-info'
import { CodeLanguage } from '../nodes/code/types'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import Empty from './empty'
import ValueContent from './value-content'

type Props = {
  nodeId: string
  currentNodeVar?: currentVarType
  handleOpenMenu: () => void
  isValueFetching?: boolean
}

const Right = ({
  nodeId,
  currentNodeVar,
  handleOpenMenu,
  isValueFetching,
}: Props) => {
  const { t } = useTranslation()
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const toolIcon = useToolIcon(currentNodeVar?.nodeData)
  const isTruncated = currentNodeVar?.var.is_truncated
  const fullContent = currentNodeVar?.var.full_content

  const {
    resetConversationVar,
    resetToLastRunVar,
    editInspectVarValue,
  } = useCurrentVars()

  const handleValueChange = (varId: string, value: any) => {
    if (!currentNodeVar)
      return
    editInspectVarValue(currentNodeVar.nodeId, varId, value)
  }

  const resetValue = () => {
    if (!currentNodeVar)
      return
    resetToLastRunVar(currentNodeVar.nodeId, currentNodeVar.var.id)
  }

  const handleClose = () => {
    setShowVariableInspectPanel(false)
    setCurrentFocusNodeId('')
  }

  const handleClear = () => {
    if (!currentNodeVar)
      return
    resetConversationVar(currentNodeVar.var.id)
  }

  const getCopyContent = () => {
    const value = currentNodeVar?.var.value
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

    // if (blockType === BlockEnum.Agent) {
    //   return node?.data?.agent_parameters?.instruction?.value
    // }
    if (blockType === BlockEnum.Code)
      return node?.data?.code
  }, [canShowPromptGenerator])

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

        //  Agent is a plugin, may has many instructions, can not locate which one to update
        // case BlockEnum.Agent:
        //   if (draft?.agent_parameters?.instruction) {
        //     draft.agent_parameters.instruction.value = res.modified
        //   }
        //   break
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
    } as any)
    handleHidePromptGenerator()
  }, [setInputs, blockType, nodeId, node?.data, handleHidePromptGenerator])

  const displaySchemaType = currentNodeVar?.var.schemaType ? (`(${currentNodeVar.var.schemaType})`) : ''

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pt-2">
        {bottomPanelWidth < 488 && (
          <ActionButton className="shrink-0" onClick={handleOpenMenu}>
            <RiMenuLine className="h-4 w-4" />
          </ActionButton>
        )}
        <div className="flex w-0 grow items-center gap-1">
          {currentNodeVar?.var && (
            <>
              {
                [VarInInspectType.environment, VarInInspectType.conversation, VarInInspectType.system].includes(currentNodeVar.nodeType as VarInInspectType) && (
                  <VariableIconWithColor
                    variableCategory={currentNodeVar.nodeType as VarInInspectType}
                    className="size-4"
                  />
                )
              }
              {currentNodeVar.nodeType !== VarInInspectType.environment
                && currentNodeVar.nodeType !== VarInInspectType.conversation
                && currentNodeVar.nodeType !== VarInInspectType.system
                && (
                  <>
                    <BlockIcon
                      className="shrink-0"
                      type={currentNodeVar.nodeType as BlockEnum}
                      size="xs"
                      toolIcon={toolIcon}
                    />
                    <div className="system-sm-regular shrink-0 text-text-secondary">{currentNodeVar.title}</div>
                    <div className="system-sm-regular shrink-0 text-text-quaternary">/</div>
                  </>
                )}
              <div title={currentNodeVar.var.name} className="system-sm-semibold truncate text-text-secondary">{currentNodeVar.var.name}</div>
              <div className="system-xs-medium ml-1 shrink-0 space-x-2 text-text-tertiary">
                <span>{`${currentNodeVar.var.value_type}${displaySchemaType}`}</span>
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
          {currentNodeVar && (
            <>
              {canShowPromptGenerator && (
                <Tooltip popupContent={t('generate.optimizePromptTooltip', { ns: 'appDebug' })}>
                  <div
                    className="cursor-pointer rounded-md p-1 hover:bg-state-accent-active"
                    onClick={handleShowPromptGenerator}
                  >
                    <RiSparklingFill className="size-4 text-components-input-border-active-prompt-1" />
                  </div>
                </Tooltip>
              )}
              {isTruncated && (
                <Tooltip popupContent={t('debug.variableInspect.exportToolTip', { ns: 'workflow' })}>
                  <ActionButton>
                    <a
                      href={fullContent?.download_url}
                      target="_blank"
                    >
                      <RiFileDownloadFill className="size-4" />
                    </a>
                  </ActionButton>
                </Tooltip>
              )}
              {!isTruncated && currentNodeVar.var.edited && (
                <Badge>
                  <span className="ml-[2.5px] mr-[4.5px] h-[3px] w-[3px] rounded bg-text-accent-secondary"></span>
                  <span className="system-2xs-semibold-uupercase">{t('debug.variableInspect.edited', { ns: 'workflow' })}</span>
                </Badge>
              )}
              {!isTruncated && currentNodeVar.var.edited && currentNodeVar.var.type !== VarInInspectType.conversation && (
                <Tooltip popupContent={t('debug.variableInspect.reset', { ns: 'workflow' })}>
                  <ActionButton onClick={resetValue}>
                    <RiArrowGoBackLine className="h-4 w-4" />
                  </ActionButton>
                </Tooltip>
              )}
              {!isTruncated && currentNodeVar.var.edited && currentNodeVar.var.type === VarInInspectType.conversation && (
                <Tooltip popupContent={t('debug.variableInspect.resetConversationVar', { ns: 'workflow' })}>
                  <ActionButton onClick={handleClear}>
                    <RiArrowGoBackLine className="h-4 w-4" />
                  </ActionButton>
                </Tooltip>
              )}
              {currentNodeVar.var.value_type !== 'secret' && (
                <CopyFeedback content={getCopyContent()} />
              )}
            </>
          )}
          <ActionButton onClick={handleClose}>
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
      </div>
      {/* content */}
      <div className="grow p-2">
        {!currentNodeVar?.var && <Empty />}
        {isValueFetching && (
          <div className="flex h-full items-center justify-center">
            <Loading />
          </div>
        )}
        {currentNodeVar?.var && !isValueFetching && (
          <ValueContent
            key={`${currentNodeVar.nodeId}-${currentNodeVar.var.id}`}
            currentVar={currentNodeVar.var}
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
  )
}

export default Right
