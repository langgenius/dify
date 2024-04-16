import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Input from './form-input'
import { PortalSelect } from '@/app/components/base/select'
import Button from '@/app/components/base/button'

const Form = () => {
  const { t } = useTranslation()
  const {
    inputsForms,
    newConversationInputs,
    handleNewConversationInputsChange,
    isMobile,
  } = useChatWithHistoryContext()

  const handleFormChange = useCallback((variable: string, value: string) => {
    handleNewConversationInputsChange({
      ...newConversationInputs,
      [variable]: value,
    })
  }, [newConversationInputs, handleNewConversationInputsChange])

  const onGetCurrentPosition = (key: any) => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const result = `lat:${position.coords.latitude},lon:${position.coords.longitude}`
          handleNewConversationInputsChange({ ...newConversationInputs, [key]: result })
        },
        (error) => {
          console.log(error.message)
        },
      )
    }
    else {
      console.log('Geolocation is not supported by this browser.')
    }
  }

  const renderField = (form: any) => {
    const {
      label,
      required,
      variable,
      options,
    } = form

    if (form.type === 'text-input' || form.type === 'paragraph') {
      return (
        <Input
          form={form}
          value={newConversationInputs[variable]}
          onChange={handleFormChange}
        />
      )
    }

    if (form.type === 'geolocation') {
      return (
        <div className={'w-full'}>
          <Input
            form={form}
            value={newConversationInputs[variable]}
            onChange={handleFormChange}
          />
          <Button
            type="primary"
            onClick={() => onGetCurrentPosition(variable)}
            className='!h-8 !p-3'>
            <span className='uppercase text-[13px]'>{t('appDebug.variableConig.getCurrentLocation')}</span>
          </Button>
        </div>
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
