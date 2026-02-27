'use client'
import type { HumanInputFormProps } from './type'
import type { ButtonProps } from '@/app/components/base/button'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import Button from '@/app/components/base/button'
import ContentItem from './content-item'
import { getButtonStyle, initializeInputs, splitByOutputVar } from './utils'

const HumanInputForm = ({
  formData,
  onSubmit,
}: HumanInputFormProps) => {
  const formToken = formData.form_token
  const defaultInputs = initializeInputs(formData.inputs, formData.resolved_default_values || {})
  const contentList = splitByOutputVar(formData.form_content)
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = useCallback((name: string, value: string) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }, [])

  const submit = async (formToken: string, actionID: string, inputs: Record<string, string>) => {
    setIsSubmitting(true)
    await onSubmit?.(formToken, { inputs, action: actionID })
    setIsSubmitting(false)
  }

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
            disabled={isSubmitting}
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
