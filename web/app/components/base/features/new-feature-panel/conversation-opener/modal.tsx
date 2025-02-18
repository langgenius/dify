import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import produce from 'immer'
import { ReactSortable } from 'react-sortablejs'
import { RiAddLine, RiAsterisk, RiCloseLine, RiDeleteBinLine, RiDraggable } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import ConfirmAddVar from '@/app/components/app/configuration/config-prompt/confirm-add-var'
import type { OpeningStatement } from '@/app/components/base/features/types'
import { getInputKeys } from '@/app/components/base/block-input'
import type { PromptVariable } from '@/models/debug'
import type { InputVar } from '@/app/components/workflow/types'
import { getNewVar } from '@/utils/var'
import cn from '@/utils/classnames'

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
    setTempValue(data.opening_statement || '')
  }, [data.opening_statement])
  const [tempSuggestedQuestions, setTempSuggestedQuestions] = useState(data.suggested_questions || [])
  const [isShowConfirmAddVar, { setTrue: showConfirmAddVar, setFalse: hideConfirmAddVar }] = useBoolean(false)
  const [notIncludeKeys, setNotIncludeKeys] = useState<string[]>([])

  const handleSave = useCallback((ignoreVariablesCheck?: boolean) => {
    if (!ignoreVariablesCheck) {
      const keys = getInputKeys(tempValue)
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
  }, [data, onSave, promptVariables, workflowVariables, showConfirmAddVar, tempSuggestedQuestions, tempValue])

  const cancelAutoAddVar = useCallback(() => {
    hideConfirmAddVar()
    handleSave(true)
  }, [handleSave, hideConfirmAddVar])

  const autoAddVar = useCallback(() => {
    onAutoAddPromptVariable?.([
      ...notIncludeKeys.map(key => getNewVar(key, 'string')),
    ])
    hideConfirmAddVar()
    handleSave(true)
  }, [handleSave, hideConfirmAddVar, notIncludeKeys, onAutoAddPromptVariable])

  const [focusID, setFocusID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)

  const renderQuestions = () => {
    return (
      <div>
        <div className='flex items-center py-2'>
          <div className='shrink-0 flex space-x-0.5 leading-[18px] text-xs font-medium text-text-tertiary'>
            <div className='uppercase'>{t('appDebug.openingStatement.openingQuestion')}</div>
            <div>·</div>
            <div>{tempSuggestedQuestions.length}/{MAX_QUESTION_NUM}</div>
          </div>
          <Divider bgStyle='gradient' className='ml-3 grow w-0 h-px'/>
        </div>
        <ReactSortable
          className="space-y-1"
          list={tempSuggestedQuestions.map((name, index) => {
            return {
              id: index,
              name,
            }
          })}
          setList={list => setTempSuggestedQuestions(list.map(item => item.name))}
          handle='.handle'
          ghostClass="opacity-50"
          animation={150}
        >
          {tempSuggestedQuestions.map((question, index) => {
            return (
              <div
                className={cn(
                  'group relative rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg flex items-center pl-2.5 hover:bg-components-panel-on-panel-item-bg-hover',
                  focusID === index && 'border-components-input-border-active hover:border-components-input-border-active bg-components-input-bg-active hover:bg-components-input-bg-active',
                  deletingID === index && 'border-components-input-border-destructive hover:border-components-input-border-destructive bg-state-destructive-hover hover:bg-state-destructive-hover',
                )}
                key={index}
              >
                <RiDraggable className='handle w-4 h-4 text-text-quaternary cursor-grab' />
                <input
                  type="input"
                  value={question || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    setTempSuggestedQuestions(tempSuggestedQuestions.map((item, i) => {
                      if (index === i)
                        return value

                      return item
                    }))
                  }}
                  className={'w-full overflow-x-auto pl-1.5 pr-8 text-sm leading-9 text-text-secondary border-0 grow h-9 bg-transparent focus:outline-none cursor-pointer rounded-lg'}
                  onFocus={() => setFocusID(index)}
                  onBlur={() => setFocusID(null)}
                />

                <div
                  className='block absolute top-1/2 translate-y-[-50%] right-1.5 p-1 rounded-md cursor-pointer text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive'
                  onClick={() => {
                    setTempSuggestedQuestions(tempSuggestedQuestions.filter((_, i) => index !== i))
                  }}
                  onMouseEnter={() => setDeletingID(index)}
                  onMouseLeave={() => setDeletingID(null)}
                >
                  <RiDeleteBinLine className='w-3.5 h-3.5' />
                </div>
              </div>
            )
          })}</ReactSortable>
        {tempSuggestedQuestions.length < MAX_QUESTION_NUM && (
          <div
            onClick={() => { setTempSuggestedQuestions([...tempSuggestedQuestions, '']) }}
            className='mt-1 flex items-center h-9 px-3 gap-2 rounded-lg cursor-pointer text-components-button-tertiary-text  bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover'>
            <RiAddLine className='w-4 h-4' />
            <div className='system-sm-medium text-[13px]'>{t('appDebug.variableConfig.addOption')}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal
      isShow
      onClose={() => { }}
      className='!p-6 !mt-14 !max-w-none !w-[640px] !bg-components-panel-bg-blur'
    >
      <div className='flex items-center justify-between mb-6'>
        <div className='text-text-primary title-2xl-semi-bold'>{t('appDebug.feature.conversationOpener.title')}</div>
        <div className='p-1 cursor-pointer' onClick={onCancel}><RiCloseLine className='w-4 h-4 text-text-tertiary'/></div>
      </div>
      <div className='flex gap-2 mb-8'>
        <div className='shrink-0 mt-1.5 w-8 h-8 p-1.5 rounded-lg border-components-panel-border bg-util-colors-orange-dark-orange-dark-500'>
          <RiAsterisk className='w-5 h-5 text-text-primary-on-surface' />
        </div>
        <div className='grow p-3 bg-chat-bubble-bg rounded-2xl border-t border-divider-subtle shadow-xs'>
          <textarea
            value={tempValue}
            rows={3}
            onChange={e => setTempValue(e.target.value)}
            className="w-full px-0 text-text-secondary system-md-regular  border-0 bg-transparent focus:outline-none"
            placeholder={t('appDebug.openingStatement.placeholder') as string}
          />
          {renderQuestions()}
        </div>
      </div>
      <div className='flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={() => handleSave()}
        >
          {t('common.operation.save')}
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
    </Modal>
  )
}

export default OpeningSettingModal
