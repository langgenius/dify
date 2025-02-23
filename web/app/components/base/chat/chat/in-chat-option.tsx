import { useCallback, useEffect } from 'react'
import { useChatWithHistoryContext } from '../chat-with-history/context'
import { PortalSelect } from '@/app/components/base/select'

const Form = () => {
  const {
    inputsForms,
    inChatInputs,
    inChatInputsRef,
    handleInChatInputsChange,
  } = useChatWithHistoryContext()
  const inChatForms = inputsForms
    .filter(({ is_chat_option }) => is_chat_option)
    .sort((a, b) => a.type === 'number' ? -1 : b.type === 'number' ? 1 : 0)

  const handleFormChange = useCallback((variable: string, value: any) => {
    handleInChatInputsChange({
      ...inChatInputsRef?.current,
      [variable]: value,
    })
  }, [inChatInputsRef, handleInChatInputsChange])

  useEffect(() => {
    inChatForms
      .filter(form => form.type === 'number')
      .forEach((form) => {
        if (!inChatInputs[form.variable])
          handleFormChange(form.variable, '0')
      })
  }, [inChatForms])

  const renderField = (form: any) => {
    const {
      label,
      variable,
      options,
    } = form

    if (form.type === 'number') {
      return (
        <button
          className={`h-9 px-4 rounded-lg border border-primary-600 transition-colors ${
            inChatInputs[variable] === '1'
              ? 'bg-primary-600 text-white'
              : 'text-gray-400'
          }`}
          onClick={() => handleFormChange(variable, inChatInputs[variable] === '1' ? '0' : '1')}
        >
          {label}
        </button>
      )
    }
    else if (form.type === 'select') {
      return (
        <PortalSelect
          popupClassName='w-[200px]'
          triggerClassName='h-9 rounded-lg border-primary-600 border bg-transparent'
          triggerClassNameFn={open =>
            inChatInputs[variable]
              ? 'bg-primary-600 text-white'
              : 'text-gray-400'
          }
          value={inChatInputs[variable]}
          items={options.map((option: string) => ({ value: option, name: option }))}
          onSelect={item => handleFormChange(variable, item.value as string)}
          placeholder={`${label}`}
        />
      )
    }
    return null
  }

  if (!inChatForms.length)
    return null

  return (
    <div className="-translate-y-2 m-1 mt-0 px-2.5 py-2 pt-4 bg-util-colors-indigo-indigo-50 rounded-b-[10px] border-l border-b border-r border-components-panel-border-subtle flex space-x-1">
      {
        inChatForms.map(form => (
          <div
            key={form.variable}
          >
            {renderField(form)}
          </div>
        ))
      }
    </div>
  )
}

export default Form
