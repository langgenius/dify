import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import { PortalSelect } from '@/app/components/base/select'

const Form = () => {
  const { t } = useTranslation()
  const {
    inputsForms,
    newConversationInputs,
    handleNewConversationInputsChange,
    isMobile,
  } = useChatWithHistoryContext()

  const handleFormChange = (variable: string, value: string) => {
    handleNewConversationInputsChange({
      ...newConversationInputs,
      [variable]: value,
    })
  }

  const renderField = (form: any) => {
    const {
      label,
      required,
      max_length,
      variable,
      options,
    } = form

    if (form.type === 'text-input') {
      return (
        <input
          className='grow h-9 rounded-lg bg-gray-100 px-2.5 outline-none appearance-none'
          value={newConversationInputs[variable] || ''}
          maxLength={max_length}
          onChange={e => handleFormChange(variable, e.target.value)}
          placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
        />
      )
    }
    if (form.type === 'paragraph') {
      return (
        <textarea
          value={newConversationInputs[variable]}
          className='grow h-[104px] rounded-lg bg-gray-100 px-2.5 py-2 outline-none appearance-none resize-none'
          onChange={e => handleFormChange(variable, e.target.value)}
          placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
        />
      )
    }
    return (
      <PortalSelect
        popupClassName='w-[200px]'
        value={newConversationInputs[variable]}
        items={options.map((option: string) => ({ value: option, name: option }))}
        onSelect={item => handleFormChange(variable, item.value as string)}
        placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
      />
    )
  }

  if (!inputsForms.length)
    return null

  return (
    <div className='mb-4 py-2'>
      {
        inputsForms.map(form => (
          <div
            key={form.variable}
            className={`flex mb-3 last-of-type:mb-0 text-sm text-gray-900 ${isMobile && '!flex-wrap'}`}
          >
            <div className={`shrink-0 mr-2 py-2 w-[128px] ${isMobile && '!w-full'}`}>{form.label}</div>
            {renderField(form)}
          </div>
        ))
      }
    </div>
  )
}

export default Form
