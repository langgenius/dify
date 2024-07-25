import React, { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { v4 as uuid4 } from 'uuid'
import { RiCloseLine, RiDraftLine, RiInputField } from '@remixicon/react'
import VariableTypeSelector from '@/app/components/workflow/panel/chat-variable-panel/components/variable-type-select'
import Button from '@/app/components/base/button'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { ToastContext } from '@/app/components/base/toast'
import { useStore } from '@/app/components/workflow/store'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import cn from '@/utils/classnames'

export type ModalPropsType = {
  chatVar?: ConversationVariable
  onClose: () => void
  onSave: (chatVar: ConversationVariable) => void
}

const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
  ChatVarType.Object,
  ChatVarType.ArrayString,
  ChatVarType.ArrayNumber,
  ChatVarType.ArrayObject,
]

const arrayStringPlaceholder = `#  example
#  [
#     "value1",
#     "value2"
#  ]`
const arrayNumberPlaceholder = `#  example
#  [
#     100,
#     200
#  ]`
const arrayObjectPlaceholder = `#  example
#  [
#     {
#       "name": "ray",
#       "age": 20
#     },
#     {
#       "name": "lily",
#       "age": 18
#     }
#  ]`

const ChatVariableModal = ({
  chatVar,
  onClose,
  onSave,
}: ModalPropsType) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const varList = useStore(s => s.conversationVariables)
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<ChatVarType>(ChatVarType.String)
  const [value, setValue] = React.useState<any>()
  const [editInJSON, setEditInJSON] = React.useState(false)
  const [des, setDes] = React.useState<string>('')

  const editorMinHeight = useMemo(() => {
    if (type === ChatVarType.ArrayObject)
      return '240px'
    return '120px'
  }, [type])
  const placeholder = useMemo(() => {
    if (type === ChatVarType.ArrayString)
      return arrayStringPlaceholder
    if (type === ChatVarType.ArrayNumber)
      return arrayNumberPlaceholder
    if (type === ChatVarType.ArrayObject)
      return arrayObjectPlaceholder
    return ''
  }, [type])

  const handleNameChange = (v: string) => {
    if (!v)
      return setName('')
    if (!/^[a-zA-Z0-9_]+$/.test(v))
      return notify({ type: 'error', message: 'name is can only contain letters, numbers and underscores' })
    if (/^[0-9]/.test(v))
      return notify({ type: 'error', message: 'name can not start with a number' })
    setName(v)
  }

  // #TODO charVar#
  const handleSave = () => {
    if (!name)
      return notify({ type: 'error', message: 'name can not be empty' })
    if (!value)
      return notify({ type: 'error', message: 'value can not be empty' })
    if (!chatVar && varList.some(chatVar => chatVar.name === name))
      return notify({ type: 'error', message: 'name is existed' })
    onSave({
      id: chatVar ? chatVar.id : uuid4(),
      name,
      value_type: type,
      value,
      description: des,
    })
    onClose()
  }

  useEffect(() => {
    if (chatVar) {
      setName(chatVar.name)
      setType(chatVar.value_type)
      setValue(chatVar.value)
      setDes(chatVar.description)
    }
  }, [chatVar])

  useEffect(() => {
    if (type === ChatVarType.ArrayObject)
      setEditInJSON(true)
    if (type === ChatVarType.String || type === ChatVarType.Number || type === ChatVarType.Object)
      setEditInJSON(false)
  }, [type])

  return (
    <div
      className={cn('flex flex-col w-[360px] bg-components-panel-bg rounded-2xl h-full border-[0.5px] border-components-panel-border shadow-2xl')}
    >
      <div className='shrink-0 flex items-center justify-between mb-3 p-4 pb-0 text-text-primary system-xl-semibold'>
        {!chatVar ? t('workflow.chatVariable.modal.title') : t('workflow.chatVariable.modal.editTitle')}
        <div className='flex items-center'>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={onClose}
          >
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='px-4 py-2'>
        {/* name */}
        <div className='mb-4'>
          <div className='mb-1 h-6 flex items-center text-text-secondary system-sm-semibold'>{t('workflow.chatVariable.modal.name')}</div>
          <div className='flex'>
            <input
              tabIndex={0}
              className='block px-3 w-full h-8 bg-components-input-bg-normal system-sm-regular radius-md border border-transparent appearance-none outline-none caret-primary-600 hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:system-sm-regular placeholder:text-components-input-text-placeholder'
              placeholder={t('workflow.chatVariable.modal.namePlaceholder') || ''}
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              type='text'
            />
          </div>
        </div>
        {/* type */}
        <div className='mb-4'>
          <div className='mb-1 h-6 flex items-center text-text-secondary system-sm-semibold'>{t('workflow.chatVariable.modal.type')}</div>
          <div className='flex'>
            <VariableTypeSelector
              value={type}
              list={typeList}
              onSelect={setType}
              popupClassName='w-[327px]'
            />
          </div>
        </div>
        {/* default value */}
        <div className='mb-4'>
          <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold'>
            <div>{t('workflow.chatVariable.modal.value')}</div>
            {(type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) && (
              <Button
                variant='ghost'
                size='small'
                className='text-text-tertiary'
                onClick={() => setEditInJSON(!editInJSON)}
              >
                {editInJSON ? <RiInputField className='mr-1 w-3.5 h-3.5' /> : <RiDraftLine className='mr-1 w-3.5 h-3.5' />}
                {editInJSON ? t('workflow.chatVariable.modal.oneByOne') : t('workflow.chatVariable.modal.editInJSON')}
              </Button>
            )}
          </div>
          <div className='flex'>
            {(type === ChatVarType.String || type === ChatVarType.Number) && (
              <input
                tabIndex={0}
                className='block px-3 w-full h-8 bg-components-input-bg-normal system-sm-regular radius-md border border-transparent appearance-none outline-none caret-primary-600 hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:system-sm-regular placeholder:text-components-input-text-placeholder'
                placeholder={t('workflow.chatVariable.modal.valuePlaceholder') || ''}
                value={value}
                onChange={e => setValue(e.target.value)}
                type={type !== ChatVarType.Number ? 'text' : 'number'}
              />
            )}
            {type === ChatVarType.Object && (
              <div></div>
            )}
            {(type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) && !editInJSON && (
              <div></div>
            )}
            {editInJSON && (
              <div className='w-full py-2 pl-3 pr-1 rounded-[10px] bg-components-input-bg-normal' style={{ height: editorMinHeight }}>
                <CodeEditor
                  isExpand
                  noWrapper
                  // isJSONStringifyBeauty
                  language={CodeLanguage.json}
                  value={value}
                  placeholder={<div className='whitespace-pre'>{placeholder}</div>}
                  onChange={value => setValue(value)}
                />
              </div>
            )}
          </div>
        </div>
        {/* description */}
        <div className=''>
          <div className='mb-1 h-6 flex items-center text-text-secondary system-sm-semibold'>{t('workflow.chatVariable.modal.description')}</div>
          <div className='flex'>
            <textarea
              className='block p-2 w-full h-20 rounded-lg bg-components-input-bg-normal border border-transparent system-sm-regular outline-none appearance-none caret-primary-600 resize-none hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:system-sm-regular placeholder:text-components-input-text-placeholder'
              value={des}
              placeholder={t('workflow.chatVariable.modal.descriptionPlaceholder') || ''}
              onChange={e => setDes(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className='p-4 pt-2 flex flex-row-reverse rounded-b-2xl'>
        <div className='flex gap-2'>
          <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </div>
  )
}

export default ChatVariableModal
