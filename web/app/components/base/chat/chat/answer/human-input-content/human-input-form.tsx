'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { HumanInputFieldValue } from './field-renderer'
import type { HumanInputFormProps } from './type'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useCallback, useState } from 'react'
import ContentItem from './content-item'
import { getButtonStyle, getProcessedHumanInputFormInputs, hasInvalidSelectOrFileInput, initializeInputs, splitByOutputVar } from './utils'

const HumanInputForm = ({
  formData,
  onSubmit,
}: HumanInputFormProps) => {
  const formToken = formData.form_token
  const defaultInputs = initializeInputs(formData.inputs, formData.resolved_default_values || {})
  const contentList = splitByOutputVar(formData.form_content)
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = useCallback((name: string, value: HumanInputFieldValue) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }, [])

  const submit = async (formToken: string, actionID: string, inputs: Record<string, HumanInputFieldValue>) => {
    setIsSubmitting(true)
    await onSubmit?.(formToken, {
      inputs: getProcessedHumanInputFormInputs(formData.inputs, inputs) || {},
      action: actionID,
    })
    setIsSubmitting(false)
  }

  const isActionDisabled = isSubmitting || hasInvalidSelectOrFileInput(formData.inputs, inputs)

  return (
    <>
      {contentList.map((content, index) => (
        <ContentItem
          key={index}
          content={content}
          formInputFields={formData.inputs}
          inputs={inputs}
          onInputChange={handleInputsChange}
        />
      ))}
      <div className="flex flex-wrap gap-1 py-1">
        {formData.actions.map((action: UserAction) => (
          <Button
            key={action.id}
            disabled={isActionDisabled}
            variant={getButtonStyle(action.button_style) as ButtonProps['variant']}
            onClick={() => submit(formToken, action.id, inputs)}
            data-testid="action-button"
          >
            {action.title}
          </Button>
        ))}
      </div>
    </>
  )
}

export default React.memo(HumanInputForm)
