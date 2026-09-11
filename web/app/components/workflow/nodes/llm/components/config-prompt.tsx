'use client'
import type { FC } from 'react'
import type { ModelConfig, PromptItem, ValueSelector, Var, Variable } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { v4 as uuid4 } from 'uuid'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import { useWorkflowStore } from '../../../store'
import { EditionType, PromptRole } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import ConfigPromptItem from './config-prompt-item'

const i18nPrefix = 'nodes.llm'

type Props = Readonly<{
  readOnly: boolean
  nodeId: string
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  isChatModel: boolean
  isChatApp: boolean
  payload: PromptItem | PromptItem[]
  onChange: (payload: PromptItem | PromptItem[]) => void
  isShowContext: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  varList?: Variable[]
  handleAddVariable: (payload: any) => void
  modelConfig: ModelConfig
}>

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
  const { setControlPromptEditorRerenderKey } = workflowStore.getState()
  const prompts = useMemo(
    () => (isChatModel && Array.isArray(payload) ? payload : []),
    [isChatModel, payload],
  )
  const keyboardSort = useKeyboardSortable({
    items: prompts,
    onChange,
    disabled: readOnly,
    minIndex: prompts[0]?.role === PromptRole.system ? 1 : 0,
    getItemLabel: (item) => item.role || '',
  })
  const payloadWithIds = useMemo(
    () =>
      keyboardSort.items.map((item) => {
        const id = item.id || uuid4()
        return { id, p: { ...item, id } }
      }),
    [keyboardSort.items],
  )
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const handleChatModePromptChange = useCallback(
    (index: number) => {
      return (prompt: string) => {
        const newPrompt = produce(payload as PromptItem[], (draft) => {
          draft[index]![
            draft[index]!.edition_type === EditionType.jinja2 ? 'jinja2_text' : 'text'
          ] = prompt
        })
        onChange(newPrompt)
      }
    },
    [onChange, payload],
  )

  const handleChatModeEditionTypeChange = useCallback(
    (index: number) => {
      return (editionType: EditionType) => {
        const newPrompt = produce(payload as PromptItem[], (draft) => {
          draft[index]!.edition_type = editionType
        })
        onChange(newPrompt)
      }
    },
    [onChange, payload],
  )

  const handleChatModeMessageRoleChange = useCallback(
    (index: number) => {
      return (role: PromptRole) => {
        const newPrompt = produce(payload as PromptItem[], (draft) => {
          draft[index]!.role = role
        })
        onChange(newPrompt)
      }
    },
    [onChange, payload],
  )

  const handleAddPrompt = useCallback(() => {
    const newPrompt = produce(payload as PromptItem[], (draft) => {
      if (draft.length === 0) {
        draft.push({ role: PromptRole.system, text: '', id: uuid4() })

        return
      }
      const isLastItemUser = draft[draft.length - 1]!.role === PromptRole.user
      draft.push({
        role: isLastItemUser ? PromptRole.assistant : PromptRole.user,
        text: '',
        id: uuid4(),
      })
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const handleRemove = useCallback(
    (index: number) => {
      return () => {
        const newPrompt = produce(payload as PromptItem[], (draft) => {
          draft.splice(index, 1)
        })
        onChange(newPrompt)
      }
    },
    [onChange, payload],
  )

  const handleCompletionPromptChange = useCallback(
    (prompt: string) => {
      const newPrompt = produce(payload as PromptItem, (draft) => {
        draft[draft.edition_type === EditionType.jinja2 ? 'jinja2_text' : 'text'] = prompt
      })
      onChange(newPrompt)
    },
    [onChange, payload],
  )

  const handleGenerated = useCallback(
    (prompt: string) => {
      handleCompletionPromptChange(prompt)
      setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
    },
    [handleCompletionPromptChange, setControlPromptEditorRerenderKey],
  )

  const handleCompletionEditionTypeChange = useCallback(
    (editionType: EditionType) => {
      const newPrompt = produce(payload as PromptItem, (draft) => {
        draft.edition_type = editionType
      })
      onChange(newPrompt)
    },
    [onChange, payload],
  )

  const canChooseSystemRole = (() => {
    if (isChatModel && Array.isArray(payload))
      return !payload.find((item) => item.role === PromptRole.system)

    return false
  })()
  return (
    <div>
      {keyboardSort.announcement}
      {isChatModel && Array.isArray(payload) ? (
        <div>
          <div className="space-y-2">
            <ReactSortable
              className="space-y-1"
              list={payloadWithIds}
              disabled={readOnly || keyboardSort.isSorting}
              setList={(list) => {
                if (
                  keyboardSort.isSorting ||
                  (prompts.every((item) => !!item.id) &&
                    list.every((item, index) => item.id === payloadWithIds[index]?.id))
                )
                  return
                if (
                  (payload as PromptItem[])?.[0]?.role === PromptRole.system &&
                  list[0]!.p?.role !== PromptRole.system
                )
                  return

                onChange(list.map((item) => item.p))
              }}
              handle=".handle"
              ghostClass="opacity-50"
              animation={150}
            >
              {keyboardSort.items.map((item, index) => {
                const canDrag = (() => {
                  if (readOnly) return false

                  if (index === 0 && item.role === PromptRole.system) return false

                  return true
                })()
                return (
                  <div key={item.id || keyboardSort.getItemKey(index)} className="group relative">
                    {canDrag && (
                      <IconButton
                        {...keyboardSort.getHandleProps(index)}
                        className="handle pointer-events-none absolute top-1 -left-6 size-6 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 aria-pressed:pointer-events-auto aria-pressed:opacity-100"
                      >
                        <span
                          aria-hidden="true"
                          className="i-custom-vender-line-others-drag-handle size-3.5"
                        />
                      </IconButton>
                    )}
                    <ConfigPromptItem
                      instanceId={
                        item.role === PromptRole.system
                          ? `${nodeId}-chat-workflow-llm-prompt-editor`
                          : `${nodeId}-chat-workflow-llm-prompt-editor-${index}`
                      }
                      className={cn(canDrag && 'handle')}
                      headerClassName={cn(canDrag && 'cursor-grab')}
                      canNotChooseSystemRole={!canChooseSystemRole}
                      canRemove={
                        payload.length > 1 && !(index === 0 && item.role === PromptRole.system)
                      }
                      readOnly={readOnly}
                      id={item.id!}
                      nodeId={nodeId}
                      handleChatModeMessageRoleChange={handleChatModeMessageRoleChange(
                        keyboardSort.getItemKey(index),
                      )}
                      isChatModel={isChatModel}
                      isChatApp={isChatApp}
                      payload={item}
                      onPromptChange={handleChatModePromptChange(keyboardSort.getItemKey(index))}
                      onEditionTypeChange={handleChatModeEditionTypeChange(
                        keyboardSort.getItemKey(index),
                      )}
                      onRemove={handleRemove(keyboardSort.getItemKey(index))}
                      isShowContext={isShowContext}
                      hasSetBlockStatus={hasSetBlockStatus}
                      availableVars={availableVars}
                      availableNodes={availableNodesWithParent}
                      varList={varList}
                      handleAddVariable={handleAddVariable}
                      modelConfig={modelConfig}
                    />
                  </div>
                )
              })}
            </ReactSortable>
          </div>
          <AddButton
            className="mt-2"
            text={t(($) => $[`${i18nPrefix}.addMessage`], { ns: 'workflow' })}
            onClick={handleAddPrompt}
          />
        </div>
      ) : (
        <div>
          <Editor
            instanceId={`${nodeId}-chat-workflow-llm-prompt-editor`}
            title={
              <span className="capitalize">
                {t(($) => $[`${i18nPrefix}.prompt`], { ns: 'workflow' })}
              </span>
            }
            value={
              (payload as PromptItem).edition_type === EditionType.basic ||
              !(payload as PromptItem).edition_type
                ? (payload as PromptItem).text
                : (payload as PromptItem).jinja2_text || ''
            }
            onChange={handleCompletionPromptChange}
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
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(ConfigPrompt)
