'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { PromptItem } from '../../../types'
import { PromptRole } from '../../../types'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import AddButton from '@/app/components/workflow/nodes/_base/components/add-button'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'

const i18nPrefix = 'workflow.nodes.llm'

type Props = {
  readOnly: boolean
  isChatModel: boolean
  payload: PromptItem | PromptItem[]
  variables: string[]
  onChange: (payload: PromptItem | PromptItem[]) => void
}

const ConfigPrompt: FC<Props> = ({
  readOnly,
  isChatModel,
  payload,
  variables,
  onChange,
}) => {
  const { t } = useTranslation()

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
      label: 'user',
      value: PromptRole.user,
    },
    {
      label: 'system',
      value: PromptRole.system,
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
      draft.push({ role: isLastItemUser ? PromptRole.system : PromptRole.user, text: '' })
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

  return (
    <div>
      {isChatModel
        ? (
          <div>
            <div className='space-y-2'>
              {
                (payload as PromptItem[]).map((item, index) => {
                  return (
                    <Editor
                      key={index}
                      title={
                        <div className='relative left-1'>
                          <TypeSelector
                            value={item.role as string}
                            options={roleOptions}
                            onChange={handleChatModeMessageRoleChange(index)}
                          />
                        </div>
                      }
                      value={item.text}
                      onChange={handleChatModePromptChange(index)}
                      variables={variables}
                      readOnly={readOnly}
                      showRemove={(payload as PromptItem[]).length > 1}
                      onRemove={handleRemove(index)}
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
              title={<span className='capitalize'>{t(`${i18nPrefix}.prompt`)}</span>}
              value={(payload as PromptItem).text}
              onChange={handleCompletionPromptChange}
              variables={variables}
              readOnly={readOnly}
            />
          </div>
        )}
    </div>
  )
}
export default React.memo(ConfigPrompt)
