import React, { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { v4 as uuid4 } from 'uuid'
import { RiCloseLine, RiDraftLine, RiInputField } from '@remixicon/react'
import VariableTypeSelector from '@/app/components/workflow/panel/chat-variable-panel/components/variable-type-select'
import ObjectValueList from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-list'
import { DEFAULT_OBJECT_VALUE } from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'
import ArrayValueList from '@/app/components/workflow/panel/chat-variable-panel/components/array-value-list'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { ToastContext } from '@/app/components/base/toast'
import { useStore } from '@/app/components/workflow/store'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import cn from '@/utils/classnames'
import { checkKeys, replaceSpaceWithUnderscreInVarNameInput } from '@/utils/var'

export type ModalPropsType = {
  chatVar?: ConversationVariable
  onClose: () => void
  onSave: (chatVar: ConversationVariable) => void
}

type ObjectValueItem = {
  key: string
  type: ChatVarType
  value: string | number | undefined
}

const typeList = [
  ChatVarType.String,
  ChatVarType.Number,
  ChatVarType.Object,
  ChatVarType.ArrayString,
  ChatVarType.ArrayNumber,
  ChatVarType.ArrayObject,
]

const objectPlaceholder = `#  example
#  {
#     "name": "ray",
#     "age": 20
#  }`
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
  const [objectValue, setObjectValue] = React.useState<ObjectValueItem[]>([DEFAULT_OBJECT_VALUE])
  const [editorContent, setEditorContent] = React.useState<string>()
  const [editInJSON, setEditInJSON] = React.useState(false)
  const [description, setDescription] = React.useState<string>('')

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
    return objectPlaceholder
  }, [type])
  const getObjectValue = useCallback(() => {
    if (!chatVar || Object.keys(chatVar.value).length === 0)
      return [DEFAULT_OBJECT_VALUE]

    return Object.keys(chatVar.value).map((key) => {
      return {
        key,
        type: typeof chatVar.value[key] === 'string' ? ChatVarType.String : ChatVarType.Number,
        value: chatVar.value[key],
      }
    })
  }, [chatVar])
  const formatValueFromObject = useCallback((list: ObjectValueItem[]) => {
    return list.reduce((acc: any, curr) => {
      if (curr.key)
        acc[curr.key] = curr.value || null
      return acc
    }, {})
  }, [])

  const formatValue = (value: any) => {
    switch (type) {
      case ChatVarType.String:
        return value || ''
      case ChatVarType.Number:
        return value || 0
      case ChatVarType.Object:
        return editInJSON ? value : formatValueFromObject(objectValue)
      case ChatVarType.ArrayString:
      case ChatVarType.ArrayNumber:
      case ChatVarType.ArrayObject:
        return value?.filter(Boolean) || []
    }
  }

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

  const handleVarNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    replaceSpaceWithUnderscreInVarNameInput(e.target)
    if (!!e.target.value && !checkVariableName(e.target.value))
      return
    setName(e.target.value || '')
  }

  const handleTypeChange = (v: ChatVarType) => {
    setValue(undefined)
    setEditorContent(undefined)
    if (v === ChatVarType.ArrayObject)
      setEditInJSON(true)
    if (v === ChatVarType.String || v === ChatVarType.Number || v === ChatVarType.Object)
      setEditInJSON(false)
    setType(v)
  }

  const handleEditorChange = (editInJSON: boolean) => {
    if (type === ChatVarType.Object) {
      if (editInJSON) {
        const newValue = !objectValue[0].key ? undefined : formatValueFromObject(objectValue)
        setValue(newValue)
        setEditorContent(JSON.stringify(newValue))
      }
      else {
        if (!editorContent) {
          setValue(undefined)
          setObjectValue([DEFAULT_OBJECT_VALUE])
        }
        else {
          try {
            const newValue = JSON.parse(editorContent)
            setValue(newValue)
            const newObjectValue = Object.keys(newValue).map((key) => {
              return {
                key,
                type: typeof newValue[key] === 'string' ? ChatVarType.String : ChatVarType.Number,
                value: newValue[key],
              }
            })
            setObjectValue(newObjectValue)
          }
          catch {
            // ignore JSON.parse errors
          }
        }
      }
    }
    if (type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) {
      if (editInJSON) {
        const newValue = (value?.length && value.filter(Boolean).length) ? value.filter(Boolean) : undefined
        setValue(newValue)
        if (!editorContent)
          setEditorContent(JSON.stringify(newValue))
      }
      else {
        setValue(value?.length ? value : [undefined])
      }
    }
    setEditInJSON(editInJSON)
  }

  const handleEditorValueChange = (content: string) => {
    if (!content) {
      setEditorContent(content)
      return setValue(undefined)
    }
    else {
      setEditorContent(content)
      try {
        const newValue = JSON.parse(content)
        setValue(newValue)
      }
      catch {
        // ignore JSON.parse errors
      }
    }
  }

  const handleSave = () => {
    if (!checkVariableName(name))
      return
    if (!chatVar && varList.some(chatVar => chatVar.name === name))
      return notify({ type: 'error', message: 'name is existed' })
    // if (type !== ChatVarType.Object && !value)
    //   return notify({ type: 'error', message: 'value can not be empty' })
    if (type === ChatVarType.Object && objectValue.some(item => !item.key && !!item.value))
      return notify({ type: 'error', message: 'object key can not be empty' })

    onSave({
      id: chatVar ? chatVar.id : uuid4(),
      name,
      value_type: type,
      value: formatValue(value),
      description,
    })
    onClose()
  }

  useEffect(() => {
    if (chatVar) {
      setName(chatVar.name)
      setType(chatVar.value_type)
      setValue(chatVar.value)
      setDescription(chatVar.description)
      setObjectValue(getObjectValue())
      if (chatVar.value_type === ChatVarType.ArrayObject) {
        setEditorContent(JSON.stringify(chatVar.value))
        setEditInJSON(true)
      }
      else {
        setEditInJSON(false)
      }
    }
  }, [chatVar, getObjectValue])

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
        {/* name */}
        <div className='mb-4'>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.chatVariable.modal.name')}</div>
          <div className='flex'>
            <Input
              placeholder={t('workflow.chatVariable.modal.namePlaceholder') || ''}
              value={name}
              onChange={handleVarNameChange}
              onBlur={e => checkVariableName(e.target.value)}
              type='text'
            />
          </div>
        </div>
        {/* type */}
        <div className='mb-4'>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.chatVariable.modal.type')}</div>
          <div className='flex'>
            <VariableTypeSelector
              value={type}
              list={typeList}
              onSelect={handleTypeChange}
              popupClassName='w-[327px]'
            />
          </div>
        </div>
        {/* default value */}
        <div className='mb-4'>
          <div className='system-sm-semibold mb-1 flex h-6 items-center justify-between text-text-secondary'>
            <div>{t('workflow.chatVariable.modal.value')}</div>
            {(type === ChatVarType.ArrayString || type === ChatVarType.ArrayNumber) && (
              <Button
                variant='ghost'
                size='small'
                className='text-text-tertiary'
                onClick={() => handleEditorChange(!editInJSON)}
              >
                {editInJSON ? <RiInputField className='mr-1 h-3.5 w-3.5' /> : <RiDraftLine className='mr-1 h-3.5 w-3.5' />}
                {editInJSON ? t('workflow.chatVariable.modal.oneByOne') : t('workflow.chatVariable.modal.editInJSON')}
              </Button>
            )}
            {type === ChatVarType.Object && (
              <Button
                variant='ghost'
                size='small'
                className='text-text-tertiary'
                onClick={() => handleEditorChange(!editInJSON)}
              >
                {editInJSON ? <RiInputField className='mr-1 h-3.5 w-3.5' /> : <RiDraftLine className='mr-1 h-3.5 w-3.5' />}
                {editInJSON ? t('workflow.chatVariable.modal.editInForm') : t('workflow.chatVariable.modal.editInJSON')}
              </Button>
            )}
          </div>
          <div className='flex'>
            {type === ChatVarType.String && (
              // Input will remove \n\r, so use Textarea just like description area
              <textarea
                className='system-sm-regular placeholder:system-sm-regular block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'
                value={value}
                placeholder={t('workflow.chatVariable.modal.valuePlaceholder') || ''}
                onChange={e => setValue(e.target.value)}
              />
            )}
            {type === ChatVarType.Number && (
              <Input
                placeholder={t('workflow.chatVariable.modal.valuePlaceholder') || ''}
                value={value}
                onChange={e => setValue(Number(e.target.value))}
                type='number'
              />
            )}
            {type === ChatVarType.Object && !editInJSON && (
              <ObjectValueList
                list={objectValue}
                onChange={setObjectValue}
              />
            )}
            {type === ChatVarType.ArrayString && !editInJSON && (
              <ArrayValueList
                isString
                list={value || [undefined]}
                onChange={setValue}
              />
            )}
            {type === ChatVarType.ArrayNumber && !editInJSON && (
              <ArrayValueList
                isString={false}
                list={value || [undefined]}
                onChange={setValue}
              />
            )}
            {editInJSON && (
              <div className='w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1' style={{ height: editorMinHeight }}>
                <CodeEditor
                  isExpand
                  noWrapper
                  language={CodeLanguage.json}
                  value={editorContent}
                  placeholder={<div className='whitespace-pre'>{placeholder}</div>}
                  onChange={handleEditorValueChange}
                />
              </div>
            )}
          </div>
        </div>
        {/* description */}
        <div className=''>
          <div className='system-sm-semibold mb-1 flex h-6 items-center text-text-secondary'>{t('workflow.chatVariable.modal.description')}</div>
          <div className='flex'>
            <textarea
              className='system-sm-regular placeholder:system-sm-regular block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'
              value={description}
              placeholder={t('workflow.chatVariable.modal.descriptionPlaceholder') || ''}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className='flex flex-row-reverse rounded-b-2xl p-4 pt-2'>
        <div className='flex gap-2'>
          <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
          <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
        </div>
      </div>
    </div>
  )
}

export default ChatVariableModal
