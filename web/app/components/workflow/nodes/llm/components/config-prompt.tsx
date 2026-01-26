'use client'
import type { FC } from 'react'
import type { ModelConfig, NodeOutPutVar, PromptItem, PromptMessageContext, PromptTemplateItem, ValueSelector, Var, Variable } from '../../../types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { v4 as uuid4 } from 'uuid'
import { useFeatures } from '@/app/components/base/features/hooks'
import { DragHandle } from '@/app/components/base/icons/src/vender/line/others'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { extractToolConfigIds } from '@/app/components/workflow/utils'
import { cn } from '@/utils/classnames'
import { useWorkflowStore } from '../../../store'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole, VarType } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import ConfigContextItem from './config-context-item'
import ConfigPromptItem from './config-prompt-item'

const i18nPrefix = 'nodes.llm'

const cleanupToolMetadata = (content: string, metadata: Record<string, unknown>) => {
  if (!metadata || typeof metadata !== 'object' || !('tools' in metadata))
    return metadata
  const rawTools = (metadata as Record<string, unknown>).tools
  if (!rawTools || typeof rawTools !== 'object')
    return metadata
  const toolIds = extractToolConfigIds(content)
  const entries = Object.entries(rawTools as Record<string, unknown>)
  const nextTools = entries.reduce<Record<string, unknown>>((acc, [id, value]) => {
    if (toolIds.has(id))
      acc[id] = value
    return acc
  }, {})
  const nextMetadata = { ...(metadata as Record<string, unknown>) }
  if (Object.keys(nextTools).length > 0)
    nextMetadata.tools = nextTools
  else
    delete nextMetadata.tools
  return nextMetadata
}

type Props = {
  readOnly: boolean
  nodeId: string
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  isChatModel: boolean
  isChatApp: boolean
  payload: PromptItem | PromptTemplateItem[]
  onChange: (payload: PromptItem | PromptTemplateItem[]) => void
  isShowContext: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  varList?: Variable[]
  handleAddVariable: (payload: any) => void
  modelConfig: ModelConfig
}

const ConfigPrompt: FC<Props> = ({
  readOnly,
  nodeId,
  filterVar,
  isChatModel,
  isChatApp,
  payload,
  onChange,
  isShowContext,
  hasSetBlockStatus,
  varList = [],
  handleAddVariable,
  modelConfig,
}) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const features = useFeatures(s => s.features)
  const isSupportSandbox = !!features.sandbox?.enabled
  const {
    setControlPromptEditorRerenderKey,
  } = workflowStore.getState()

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const contextMenuTriggerRef = useRef<HTMLDivElement>(null)

  const payloadWithIds = (isChatModel && Array.isArray(payload))
    ? payload.map((item) => {
        const id = uuid4()
        return {
          id: item.id || id,
          p: {
            ...item,
            id: item.id || id,
          },
        }
      })
    : []
  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const contextVarOptions = useMemo<NodeOutPutVar[]>(() => {
    return availableNodesWithParent
      .filter(node => node.data.type === BlockEnum.Agent || node.data.type === BlockEnum.LLM)
      .map(node => ({
        nodeId: node.id,
        title: node.data.title,
        vars: [
          {
            variable: 'context',
            type: VarType.arrayObject,
            schemaType: 'List[promptMessage]',
          },
        ],
      }))
  }, [availableNodesWithParent])

  const handleChatModePromptChange = useCallback((index: number) => {
    return (prompt: string) => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        const item = draft[index]
        if (!isPromptMessageContext(item))
          item[item.edition_type === EditionType.jinja2 ? 'jinja2_text' : 'text'] = prompt
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleChatModeMetadataChange = useCallback((index: number) => {
    return (metadata: Record<string, unknown>) => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        const item = draft[index]
        if (!isPromptMessageContext(item)) {
          const content = item.text
          const nextMetadata = cleanupToolMetadata(content, metadata)
            ; (item as PromptItem).metadata = nextMetadata
        }
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleChatModeEditionTypeChange = useCallback((index: number) => {
    return (editionType: EditionType) => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        const item = draft[index]
        if (!isPromptMessageContext(item))
          item.edition_type = editionType
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleChatModeMessageRoleChange = useCallback((index: number) => {
    return (role: PromptRole) => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        const item = draft[index]
        if (!isPromptMessageContext(item))
          item.role = role
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleAddPrompt = useCallback(() => {
    const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
      if (draft.length === 0) {
        draft.push({ role: PromptRole.system, text: '', id: uuid4() })
        return
      }
      const lastPromptItem = [...draft].reverse().find(item => !isPromptMessageContext(item)) as PromptItem | undefined
      const isLastItemUser = lastPromptItem?.role === PromptRole.user
      draft.push({ role: isLastItemUser ? PromptRole.assistant : PromptRole.user, text: '', id: uuid4() })
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const handleAddContext = useCallback((agentNodeId: string) => {
    const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
      const contextItem: PromptMessageContext = {
        id: uuid4(),
        $context: [agentNodeId, 'context'],
      }

      const lastUserIndex = draft
        .map((item, idx) => ({ item, idx }))
        .reverse()
        .find(({ item }) => !isPromptMessageContext(item) && (item as PromptItem).role === PromptRole.user)
        ?.idx

      if (lastUserIndex !== undefined) {
        draft.splice(lastUserIndex, 0, contextItem)
        return
      }

      const promptItems = draft.filter(item => !isPromptMessageContext(item)) as PromptItem[]
      const hasOnlySystem = promptItems.length === 1 && promptItems[0].role === PromptRole.system
      if (hasOnlySystem) {
        draft.push({ role: PromptRole.user, text: '', id: uuid4() })
        draft.splice(draft.length - 1, 0, contextItem)
        return
      }

      draft.push(contextItem)
    })
    onChange(newPrompt)
    setIsContextMenuOpen(false)
  }, [onChange, payload])

  const handleAddContextVar = useCallback((value: ValueSelector, _item?: Var) => {
    if (!Array.isArray(value) || value.length < 2)
      return
    handleAddContext(value[0])
  }, [handleAddContext])

  const handleContextChange = useCallback((index: number) => {
    return (value: ValueSelector) => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        const item = draft[index]
        if (isPromptMessageContext(item))
          item.$context = value
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleRemove = useCallback((index: number) => {
    return () => {
      const newPrompt = produce(payload as PromptTemplateItem[], (draft) => {
        draft.splice(index, 1)
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleCompletionPromptChange = useCallback((prompt: string) => {
    const newPrompt = produce(payload as PromptItem, (draft) => {
      draft[draft.edition_type === EditionType.jinja2 ? 'jinja2_text' : 'text'] = prompt
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const handleCompletionMetadataChange = useCallback((metadata: Record<string, unknown>) => {
    const promptItem = payload as PromptItem
    const contentKey = promptItem.edition_type === EditionType.jinja2 ? 'jinja2_text' : 'text'
    const content = (promptItem[contentKey] ?? '') as string
    const nextMetadata = cleanupToolMetadata(content, metadata)
    const newPrompt = produce(payload as PromptItem, (draft) => {
      draft.metadata = nextMetadata
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const handleGenerated = useCallback((prompt: string) => {
    handleCompletionPromptChange(prompt)
    setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
  }, [handleCompletionPromptChange, setControlPromptEditorRerenderKey])

  const handleCompletionEditionTypeChange = useCallback((editionType: EditionType) => {
    const newPrompt = produce(payload as PromptItem, (draft) => {
      draft.edition_type = editionType
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const canChooseSystemRole = (() => {
    if (isChatModel && Array.isArray(payload)) {
      return !payload.find(item => !isPromptMessageContext(item) && (item as PromptItem).role === PromptRole.system)
    }
    return false
  })()

  return (
    <div>
      {(isChatModel && Array.isArray(payload))
        ? (
            <div>
              <div className="space-y-2">
                <ReactSortable
                  className="space-y-1"
                  list={payloadWithIds}
                  setList={(list) => {
                    const firstItem = (payload as PromptTemplateItem[])?.[0]
                    if (firstItem && !isPromptMessageContext(firstItem) && firstItem.role === PromptRole.system) {
                      const newFirstItem = list[0]?.p
                      if (newFirstItem && !isPromptMessageContext(newFirstItem) && newFirstItem.role !== PromptRole.system)
                        return
                    }
                    onChange(list.map(item => item.p))
                  }}
                  handle=".handle"
                  ghostClass="opacity-50"
                  animation={150}
                >
                  {
                    (payload as PromptTemplateItem[]).map((item, index) => {
                      if (isPromptMessageContext(item)) {
                        return (
                          <div key={item.id || index} className="group relative">
                            {!readOnly && <DragHandle className="handle absolute left-[-14px] top-2 hidden h-3.5 w-3.5 cursor-grab text-text-quaternary group-hover:block" />}
                            <ConfigContextItem
                              readOnly={readOnly}
                              payload={item}
                              contextVars={contextVarOptions}
                              availableNodes={availableNodesWithParent}
                              onChange={handleContextChange(index)}
                              onRemove={handleRemove(index)}
                            />
                          </div>
                        )
                      }

                      const canDrag = (() => {
                        if (readOnly)
                          return false

                        if (index === 0 && item.role === PromptRole.system)
                          return false

                        return true
                      })()
                      return (
                        <div key={item.id || index} className="group relative">
                          {canDrag && <DragHandle className="handle absolute left-[-14px] top-2 hidden h-3.5 w-3.5 cursor-grab text-text-quaternary group-hover:block" />}
                          <ConfigPromptItem
                            instanceId={item.role === PromptRole.system ? `${nodeId}-chat-workflow-llm-prompt-editor` : `${nodeId}-chat-workflow-llm-prompt-editor-${index}`}
                            className={cn(canDrag && 'handle')}
                            headerClassName={cn(canDrag && 'cursor-grab')}
                            canNotChooseSystemRole={!canChooseSystemRole}
                            canRemove={payload.length > 1 && !(index === 0 && item.role === PromptRole.system)}
                            readOnly={readOnly}
                            id={item.id!}
                            nodeId={nodeId}
                            handleChatModeMessageRoleChange={handleChatModeMessageRoleChange(index)}
                            isChatModel={isChatModel}
                            isChatApp={isChatApp}
                            payload={item}
                            onPromptChange={handleChatModePromptChange(index)}
                            onMetadataChange={handleChatModeMetadataChange(index)}
                            onEditionTypeChange={handleChatModeEditionTypeChange(index)}
                            onRemove={handleRemove(index)}
                            isShowContext={isShowContext}
                            hasSetBlockStatus={hasSetBlockStatus}
                            availableVars={availableVars}
                            availableNodes={availableNodesWithParent}
                            varList={varList}
                            handleAddVariable={handleAddVariable}
                            modelConfig={modelConfig}
                            isSupportSandbox={isSupportSandbox}
                          />
                        </div>
                      )
                    })
                  }
                </ReactSortable>
              </div>
              <div className="mt-2 grid grid-cols-[11fr_9fr] gap-2">
                <AddButton
                  text={t(`${i18nPrefix}.addMessage`, { ns: 'workflow' })}
                  onClick={handleAddPrompt}
                />
                <PortalToFollowElem
                  open={isContextMenuOpen}
                  onOpenChange={setIsContextMenuOpen}
                  placement="bottom-start"
                >
                  <PortalToFollowElemTrigger className="w-full" onClick={() => setIsContextMenuOpen(!isContextMenuOpen)}>
                    <div ref={contextMenuTriggerRef}>
                      <AddButton
                        text={t(`${i18nPrefix}.addContext`, { ns: 'workflow' })}
                        onClick={() => { }}
                      />
                    </div>
                  </PortalToFollowElemTrigger>
                  <PortalToFollowElemContent className="z-[1000]">
                    <div className="w-[260px] rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
                      {contextVarOptions.length > 0
                        ? (
                            <VarReferenceVars
                              vars={contextVarOptions}
                              onChange={handleAddContextVar}
                              hideSearch
                              maxHeightClass="max-h-[34vh]"
                              onClose={() => setIsContextMenuOpen(false)}
                              onBlur={() => setIsContextMenuOpen(false)}
                              autoFocus={false}
                              preferSchemaType
                            />
                          )
                        : (
                            <div className="system-xs-regular px-3 py-2 text-center text-text-tertiary">
                              {t('common.noAgentNodes', { ns: 'workflow' })}
                            </div>
                          )}
                    </div>
                  </PortalToFollowElemContent>
                </PortalToFollowElem>
              </div>
            </div>
          )
        : (
            <div>
              <Editor
                instanceId={`${nodeId}-chat-workflow-llm-prompt-editor`}
                title={<span className="capitalize">{t(`${i18nPrefix}.prompt`, { ns: 'workflow' })}</span>}
                value={((payload as PromptItem).edition_type === EditionType.basic || !(payload as PromptItem).edition_type) ? (payload as PromptItem).text : ((payload as PromptItem).jinja2_text || '')}
                onChange={handleCompletionPromptChange}
                promptMetadata={(payload as PromptItem).metadata}
                onPromptMetadataChange={handleCompletionMetadataChange}
                readOnly={readOnly}
                isChatModel={isChatModel}
                isChatApp={isChatApp}
                isShowContext={isShowContext}
                hasSetBlockStatus={hasSetBlockStatus}
                nodesOutputVars={availableVars}
                availableNodes={availableNodesWithParent}
                isSupportPromptGenerator
                isSupportJinja
                editionType={(payload as PromptItem).edition_type}
                varList={varList}
                onEditionTypeChange={handleCompletionEditionTypeChange}
                handleAddVariable={handleAddVariable}
                onGenerated={handleGenerated}
                modelConfig={modelConfig}
                isSupportSandbox={isSupportSandbox}
              />
            </div>
          )}
    </div>
  )
}
export default React.memo(ConfigPrompt)
