'use client'
import type { HumanInputFormProps } from './type'
import * as React from 'react'
import { useCallback, useState } from 'react'
import Button from '@/app/components/base/button'
import ContentItem from './content-item'
import ExpirationTime from './expiration-time'
import { getButtonStyle, initializeInputs, splitByOutputVar } from './utils'

const HumanInputForm = ({
  formData,
  showTimeout,
  onSubmit,
  expirationTime,
}: HumanInputFormProps) => {
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
      <div className="flex flex-wrap gap-1 py-1">
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
      {showTimeout && typeof expirationTime === 'number' && (
        <ExpirationTime expirationTime={expirationTime} />
      )}
    </>
  )
}

export default React.memo(HumanInputForm)
