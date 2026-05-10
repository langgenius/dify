import type { OpeningStatement } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import ConfirmAddVar from '@/app/components/app/configuration/config-prompt/confirm-add-var'
import { getInputKeys } from '@/app/components/base/block-input'
import Divider from '@/app/components/base/divider'
import PromptEditor from '@/app/components/base/prompt-editor'
import { checkKeys, getNewVar } from '@/utils/var'

type OpeningSettingModalProps = {
  data: OpeningStatement
  onSave: (newState: OpeningStatement) => void
  onCancel: () => void
  promptVariables?: PromptVariable[]
  workflowVariables?: InputVar[]
  onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
}

const MAX_QUESTION_NUM = 10

const OpeningSettingModal = ({
  data,
  onSave,
  onCancel,
  promptVariables = [],
  workflowVariables = [],
  onAutoAddPromptVariable,
}: OpeningSettingModalProps) => {
  const { t } = useTranslation()
  const [tempValue, setTempValue] = useState(data?.opening_statement || '')
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setTempValue(data.opening_statement || '')
  }, [data.opening_statement])
  const [tempSuggestedQuestions, setTempSuggestedQuestions] = useState(data.suggested_questions || [])
  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)
  const [notIncludeKeys, setNotIncludeKeys] = useState<string[]>([])

  const isSaveDisabled = useMemo(() => !tempValue.trim(), [tempValue])

  const handleSave = useCallback((ignoreVariablesCheck?: boolean) => {
    // Prevent saving if opening statement is empty
    if (isSaveDisabled)
      return

    if (!ignoreVariablesCheck) {
      const keys = getInputKeys(tempValue)?.filter((key) => {
        const { isValid } = checkKeys([key], true)
        return isValid
      })
      const promptKeys = promptVariables.map(item => item.key)
      const workflowVariableKeys = workflowVariables.map(item => item.variable)
      let notIncludeKeys: string[] = []

      if (promptKeys.length === 0 && workflowVariables.length === 0) {
        if (keys.length > 0)
          notIncludeKeys = keys
      }
      else {
        if (workflowVariables.length > 0)
          notIncludeKeys = keys.filter(key => !workflowVariableKeys.includes(key))
        else notIncludeKeys = keys.filter(key => !promptKeys.includes(key))
      }

      if (notIncludeKeys.length > 0) {
        setNotIncludeKeys(notIncludeKeys)
        showConfirmAddVar()
        return
      }
    }
    const newOpening = produce(data, (draft) => {
      if (draft) {
        draft.opening_statement = tempValue
        draft.suggested_questions = tempSuggestedQuestions
      }
    })
    onSave(newOpening)
  }, [data, onSave, promptVariables, workflowVariables, showConfirmAddVar, tempSuggestedQuestions, tempValue, isSaveDisabled])

  const cancelAutoAddVar = useCallback(() => {
    hideConfirmAddVar()
    handleSave(true)
  }, [handleSave, hideConfirmAddVar])

  const autoAddVar = useCallback(() => {
    onAutoAddPromptVariable?.(notIncludeKeys.map(key => getNewVar(key, 'string')))
    hideConfirmAddVar()
    handleSave(true)
  }, [handleSave, hideConfirmAddVar, notIncludeKeys, onAutoAddPromptVariable])

  const [focusID, setFocusID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [autoFocusQuestionID, setAutoFocusQuestionID] = useState<number | null>(null)
  const openerPlaceholder = (
    <span className="block break-words whitespace-pre-wrap">
      {t('openingStatement.placeholderLine1', { ns: 'appDebug' })}
      <br />
      {t('openingStatement.placeholderLine2', { ns: 'appDebug' })}
    </span>
  )

  const renderQuestions = () => {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className="text-sm font-medium text-text-primary">
              {t('openingStatement.openingQuestion', { ns: 'appDebug' })}
            </div>
            <Tooltip>
              <TooltipTrigger
                delay={0}
                render={(
                  <button
                    type="button"
                    className="flex items-center rounded-sm p-px text-text-quaternary hover:text-text-tertiary"
                    data-testid="opening-questions-tooltip"
                    aria-label={t('openingStatement.openingQuestionDescription', { ns: 'appDebug' })}
                  >
                    <span className="i-ri-question-line h-3.5 w-3.5" />
                  </button>
                )}
              />
              <TooltipContent className="max-w-[220px] system-sm-regular text-text-secondary">
                {t('openingStatement.openingQuestionDescription', { ns: 'appDebug' })}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-xs leading-[18px] font-medium text-text-tertiary">
            {tempSuggestedQuestions.length}
            /
            {MAX_QUESTION_NUM}
          </div>
        </div>
        <Divider bgStyle="gradient" className="mb-3 h-px" />
        <ReactSortable
          className="space-y-1"
          list={tempSuggestedQuestions.map((name, index) => {
            return {
              id: index,
              name,
            }
          })}
          setList={list => setTempSuggestedQuestions(list.map(item => item.name))}
          handle=".handle"
          ghostClass="opacity-50"
          animation={150}
        >
          {tempSuggestedQuestions.map((question, index) => {
            return (
              <div
                className={cn(
                  'group relative flex items-center rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-2.5 hover:bg-components-panel-on-panel-item-bg-hover',
                  deletingID === index && 'border-components-input-border-destructive bg-state-destructive-hover hover:border-components-input-border-destructive hover:bg-state-destructive-hover',
                  focusID === index && 'border-components-input-border-active bg-components-input-bg-active hover:border-components-input-border-active hover:bg-components-input-bg-active',
                )}
                key={index}
              >
                <span className="handle i-ri-draggable h-4 w-4 cursor-grab text-text-quaternary" />
                <input
                  type="input"
                  value={question || ''}
                  placeholder={t('openingStatement.openingQuestionPlaceholder', { ns: 'appDebug' }) as string}
                  onChange={(e) => {
                    const value = e.target.value
                    setTempSuggestedQuestions(tempSuggestedQuestions.map((item, i) => {
                      if (index === i)
                        return value

                      return item
                    }))
                  }}
                  autoFocus={autoFocusQuestionID === index}
                  className="h-9 w-full grow cursor-pointer overflow-x-auto rounded-lg border-0 bg-transparent pr-8 pl-1.5 text-sm leading-9 text-text-secondary focus:outline-hidden"
                  onFocus={() => {
                    setFocusID(index)
                    if (autoFocusQuestionID === index)
                      setAutoFocusQuestionID(null)
                  }}
                  onBlur={() => setFocusID(null)}
                />

                <div
                  className="absolute top-1/2 right-1.5 block translate-y-[-50%] cursor-pointer rounded-md p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
                  onClick={() => {
                    setTempSuggestedQuestions(tempSuggestedQuestions.filter((_, i) => index !== i))
                  }}
                  onMouseEnter={() => setDeletingID(index)}
                  onMouseLeave={() => setDeletingID(null)}
                >
                  <span className="i-ri-delete-bin-line h-3.5 w-3.5" data-testid={`delete-question-${question}`} />
                </div>
              </div>
            )
          })}
        </ReactSortable>
        {tempSuggestedQuestions.length < MAX_QUESTION_NUM && (
          <div
            onClick={() => {
              const nextIndex = tempSuggestedQuestions.length
              setDeletingID(null)
              setAutoFocusQuestionID(nextIndex)
              setTempSuggestedQuestions([...tempSuggestedQuestions, ''])
            }}
            className="mt-1 flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-components-button-tertiary-bg px-3 text-components-button-tertiary-text hover:bg-components-button-tertiary-bg-hover"
          >
            <span className="i-ri-add-line h-4 w-4" />
            <div className="system-sm-medium text-[13px]">{t('variableConfig.addOption', { ns: 'appDebug' })}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()} disablePointerDismissal>
      <DialogContent className="mt-14 w-[640px] max-w-none rounded-2xl bg-components-panel-bg-blur p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="title-2xl-semi-bold text-text-primary">{t('feature.conversationOpener.title', { ns: 'appDebug' })}</div>
          <button
            type="button"
            aria-label={t('operation.close', { ns: 'common' })}
            className="cursor-pointer border-none bg-transparent p-1 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={onCancel}
          >
            <span className="i-ri-close-line h-4 w-4 text-text-tertiary" aria-hidden="true" />
          </button>
        </div>
        <div className="mb-8 space-y-4">
          <div
            data-testid="opener-input-section"
            className="py-2"
          >
            <div className="mb-3 text-sm font-medium text-text-primary">
              {t('openingStatement.editorTitle', { ns: 'appDebug' })}
            </div>
            <div className="relative min-h-[80px] rounded-lg bg-components-input-bg-normal px-3 py-2">
              <PromptEditor
                value={tempValue}
                onChange={setTempValue}
                placeholder={openerPlaceholder}
                placeholderClassName="!overflow-visible !whitespace-pre-wrap !text-clip break-words pr-8"
                variableBlock={{
                  show: true,
                  variables: [
                    // Prompt variables
                    ...promptVariables.map(item => ({
                      name: item.name || item.key,
                      value: item.key,
                    })),
                    // Workflow variables
                    ...workflowVariables.map(item => ({
                      name: item.variable,
                      value: item.variable,
                    })),
                  ],
                }}
              />
            </div>
          </div>
          <div
            data-testid="opener-questions-section"
            className="py-2"
          >
            {renderQuestions()}
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Button
            onClick={onCancel}
            className="mr-2"
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSave()}
            disabled={isSaveDisabled}
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
        {isShowConfirmAddVar && (
          <ConfirmAddVar
            varNameArr={notIncludeKeys}
            onConfirm={autoAddVar}
            onCancel={cancelAutoAddVar}
            onHide={hideConfirmAddVar}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export default OpeningSettingModal
