'use client'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ContentItem from './content-item'
import { getButtonStyle, initializeInputs, splitByOutputVar } from './utils'
import type { HumanInputFormProps } from './type'

const HumanInputForm = ({
  formData,
  showTimeout,
  timeout,
  timeoutUnit,
  onSubmit,
}: HumanInputFormProps) => {
  const { t } = useTranslation()

  const formID = formData.form_id
  const defaultInputs = initializeInputs(formData.inputs)
  const contentList = splitByOutputVar(formData.form_content)
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = useCallback((name: string, value: any) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }, [])

  const submit = async (formID: string, actionID: string, inputs: Record<string, any>) => {
    setIsSubmitting(true)
    await onSubmit?.(formID, { inputs, action: actionID })
    setIsSubmitting(false)
  }

  return (
    <>
      {contentList.map((content, index) => (
        <ContentItem
          key={index}
          content={content}
          formInputFields={formData.inputs}
          resolvedPlaceholderValues={formData.resolved_placeholder_values || {}}
          inputs={inputs}
          onInputChange={handleInputsChange}
        />
      ))}
      <div className='flex flex-wrap gap-1 py-1'>
        {formData.actions.map((action: any) => (
          <Button
            key={action.id}
            disabled={isSubmitting}
            variant={getButtonStyle(action.button_style) as any}
            onClick={() => submit(formID, action.id, inputs)}
          >
            {action.title}
          </Button>
        ))}
      </div>
      {showTimeout && (
        <div className='system-xs-regular mt-1 text-text-tertiary'>
          {timeoutUnit === 'day' ? t('share.humanInput.timeoutDay', { count: timeout }) : t('share.humanInput.timeoutHour', { count: timeout })}
        </div>
      )}
    </>
  )
}

export default React.memo(HumanInputForm)
