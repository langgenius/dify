'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { PromptItem, ValueSelector, Var } from '../../../types'
import { PromptRole } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import ConfigPromptItem from './config-prompt-item'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
const i18nPrefix = 'workflow.nodes.llm'

type Props = {
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
}) => {
  const { t } = useTranslation()
  const {
    availableVars,
    availableNodes,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const handleChatModePromptChange = useCallback((index: number) => {
    return (prompt: string) => {
      const newPrompt = produce(payload as PromptItem[], (draft) => {
        draft[index].text = prompt
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleChatModeMessageRoleChange = useCallback((index: number) => {
    return (role: PromptRole) => {
      const newPrompt = produce(payload as PromptItem[], (draft) => {
        draft[index].role = role
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleAddPrompt = useCallback(() => {
    const newPrompt = produce(payload as PromptItem[], (draft) => {
      const isLastItemUser = draft[draft.length - 1].role === PromptRole.user
      draft.push({ role: isLastItemUser ? PromptRole.assistant : PromptRole.user, text: '' })
    })
    onChange(newPrompt)
  }, [onChange, payload])

  const handleRemove = useCallback((index: number) => {
    return () => {
      const newPrompt = produce(payload as PromptItem[], (draft) => {
        draft.splice(index, 1)
      })
      onChange(newPrompt)
    }
  }, [onChange, payload])

  const handleCompletionPromptChange = useCallback((prompt: string) => {
    const newPrompt = produce(payload as PromptItem, (draft) => {
      draft.text = prompt
    })
    onChange(newPrompt)
  }, [onChange, payload])

  // console.log(getInputVars((payload as PromptItem).text))

  return (
    <div>
      {(isChatModel && Array.isArray(payload))
        ? (
          <div>
            <div className='space-y-2'>
              {
                (payload as PromptItem[]).map((item, index) => {
                  return (
                    <ConfigPromptItem
                      key={`${payload.length}-${index}`}
                      canRemove={payload.length > 1}
                      readOnly={readOnly}
                      id={`${payload.length}-${index}`}
                      handleChatModeMessageRoleChange={handleChatModeMessageRoleChange(index)}
                      isChatModel={isChatModel}
                      isChatApp={isChatApp}
                      payload={item}
                      onPromptChange={handleChatModePromptChange(index)}
                      onRemove={handleRemove(index)}
                      isShowContext={isShowContext}
                      hasSetBlockStatus={hasSetBlockStatus}
                      availableVars={availableVars}
                      availableNodes={availableNodes}
                    />
                  )
                })

              }
            </div>
            <AddButton
              className='mt-2'
              text={t(`${i18nPrefix}.addMessage`)}
              onClick={handleAddPrompt}
            />
          </div>
        )
        : (
          <div>
            <Editor
              instanceId={`${nodeId}-chat-workflow-llm-prompt-editor`}
              title={<span className='capitalize'>{t(`${i18nPrefix}.prompt`)}</span>}
              value={(payload as PromptItem).text}
              onChange={handleCompletionPromptChange}
              readOnly={readOnly}
              isChatModel={isChatModel}
              isChatApp={isChatApp}
              isShowContext={isShowContext}
              hasSetBlockStatus={hasSetBlockStatus}
              nodesOutputVars={availableVars}
              availableNodes={availableNodes}
            />
          </div>
        )}
    </div>
  )
}
export default React.memo(ConfigPrompt)
