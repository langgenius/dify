import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  useForm as useTanstackForm,
  useStore as useTanstackStore,
} from '@tanstack/react-form'
import { RiCloseLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { ToastContext } from '@/app/components/base/toast'
import { useStore } from '@/app/components/workflow/store'
import type { ConversationVariable, MemoryVariable } from '@/app/components/workflow/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import cn from '@/utils/classnames'
import { checkKeys } from '@/utils/var'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import VariableForm from '@/app/components/base/form/form-scenarios/variable'
import { useForm } from '../hooks'

export type ModalPropsType = {
  className?: string
  chatVar?: ConversationVariable | MemoryVariable
  onClose: () => void
  onSave: (chatVar: ConversationVariable | MemoryVariable) => void
  nodeScopeMemoryVariable?: {
    nodeId: string
  }
}

const ChatVariableModal = ({
  chatVar,
  onClose,
  onSave,
  nodeScopeMemoryVariable,
}: ModalPropsType) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const varList = useStore(s => s.conversationVariables)

  const {
    formSchemas,
    defaultValues,
  } = useForm(chatVar, nodeScopeMemoryVariable)
  const formRef = useRef<FormRefObject>(null)
  const form = useTanstackForm({
    defaultValues,
  })
  const type = useTanstackStore(form.store, (s: any) => s.values.value_type)

  const checkVariableName = (value: string) => {
    const { isValid, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: t('workflow.env.modal.name') }),
      })
      return false
    }
    return true
  }

  const handleConfirm = useCallback(async () => {
    const {
      values,
      isCheckValidated,
    } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
    }) || { isCheckValidated: false, values: {} }
    const {
      name,
      value_type,
      value,
      editInJSON,
      ...rest
    } = values
    if (!isCheckValidated)
      return
    if (!checkVariableName(name))
      return
    if (!chatVar && varList.some(chatVar => chatVar.name === name))
      return notify({ type: 'error', message: 'name is existed' })
    if (value_type === ChatVarType.Object && value.some((item: any) => !item.key && !!item.value))
      return notify({ type: 'error', message: 'object key can not be empty' })

    onSave({
      id: chatVar ? chatVar.id : `${Date.now()}`,
      name,
      value_type,
      value: editInJSON ? JSON.parse(value) : value,
      ...rest,
    })
    onClose()
  }, [onClose, notify, t, varList, chatVar, checkVariableName])

  return (
    <div
      className={cn('flex h-full w-[360px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl', type === ChatVarType.Object && 'w-[480px]')}
    >
      <div className='system-xl-semibold mb-3 flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary'>
        {!chatVar ? t('workflow.chatVariable.modal.title') : t('workflow.chatVariable.modal.editTitle')}
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={onClose}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='max-h-[480px] overflow-y-auto px-4 py-2'>
        <VariableForm
          formFromProps={form}
          ref={formRef}
          formSchemas={formSchemas as FormSchema[]}
          defaultValues={defaultValues}
        />
      </div>
      <div className='flex flex-row-reverse rounded-b-2xl p-4 pt-2'>
        <div className='flex gap-2'>
          <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleConfirm}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </div>
  )
}

export default ChatVariableModal
