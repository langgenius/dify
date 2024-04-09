'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { PromptItem, ValueSelector, Var } from '../../../types'
import { PromptRole } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
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

  const roleOptions = [
    {
      label: 'system',
      value: PromptRole.system,
    },
    {
      label: 'user',
      value: PromptRole.user,
    },
    {
      label: 'assistant',
      value: PromptRole.assistant,
    },
  ]

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
                    <Editor
                      instanceId={`${nodeId}-chat-workflow-llm-prompt-editor-${item.role}-${index}`}
                      key={index}
                      title={
                        <div className='relative left-1 flex items-center'>
                          <TypeSelector
                            value={item.role as string}
                            options={roleOptions}
                            onChange={handleChatModeMessageRoleChange(index)}
                            triggerClassName='text-xs font-semibold text-gray-700 uppercase'
                            itemClassName='text-[13px] font-medium text-gray-700'
                          />
                          <TooltipPlus
                            popupContent={
                              <div className='max-w-[180px]'>{t(`${i18nPrefix}.roleDescription.${item.role}`)}</div>
                            }
                          >
                            <HelpCircle className='w-3.5 h-3.5 text-gray-400' />
                          </TooltipPlus>
                        </div>
                      }
                      value={item.text}
                      onChange={handleChatModePromptChange(index)}
                      readOnly={readOnly}
                      showRemove={(payload as PromptItem[]).length > 1}
                      onRemove={handleRemove(index)}
                      isChatModel={isChatModel}
                      isChatApp={isChatApp}
                      isShowContext={isShowContext}
                      hasSetBlockStatus={hasSetBlockStatus}
                      nodesOutputVars={availableVars}
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
