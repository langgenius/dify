'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ContentItem from './content-item'
import type { GeneratedFormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import { getButtonStyle, initializeInputs, splitByOutputVar } from './utils'
// import { getHumanInputForm, submitHumanInputForm } from '@/service/share'
// import cn from '@/utils/classnames'

export type FormData = {
  form_id: string
  site: any
  form_content: string
  inputs: GeneratedFormInputItem[]
  user_actions: UserAction[]
  timeout: number
  timeout_unit: 'hour' | 'day'
}

export type Props = {
  formData: FormData
  showTimeout?: boolean
  onSubmit?: (formID: string, data: any) => void
}

const HumanInputForm = ({
  formData,
  showTimeout,
  onSubmit,
}: Props) => {
  const { t } = useTranslation()

  const formID = formData.form_id
  const defaultInputs = initializeInputs(formData.inputs)
  const contentList = splitByOutputVar(formData.form_content)
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = (name: string, value: any) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }

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
          inputs={inputs}
          onInputChange={handleInputsChange}
        />
      ))}
      <div className='flex flex-wrap gap-1 py-1'>
        {formData.user_actions.map((action: any) => (
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
          {formData.timeout_unit === 'day' ? t('share.humanInput.timeoutDay', { count: formData.timeout }) : t('share.humanInput.timeoutHour', { count: formData.timeout })}
        </div>
      )}
    </>
  )
}

export default React.memo(HumanInputForm)
