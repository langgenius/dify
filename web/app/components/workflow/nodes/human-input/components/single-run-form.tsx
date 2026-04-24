'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { RiArrowLeftLine } from '@remixicon/react'

import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import { getButtonStyle, initializeInputs, splitByOutputVar } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { fileIsUploaded } from '@/app/components/base/file-uploader/utils'
import { isFileFormInput, isFileListFormInput, isSelectFormInput } from '@/app/components/workflow/nodes/human-input/types'

type Props = {
  nodeName: string
  data: HumanInputFormData
  showBackButton?: boolean
  handleBack?: () => void
  onSubmit?: ({ inputs, action }: { inputs: Record<string, HumanInputFieldValue>, action: string }) => Promise<void>
}

const isUploadedFile = (value: HumanInputFieldValue | undefined) => {
  return !!value
    && !Array.isArray(value)
    && typeof value !== 'string'
    && !!fileIsUploaded(value as FileEntity)
}

const hasUploadedFiles = (value: HumanInputFieldValue | undefined) => {
  return Array.isArray(value)
    && value.length > 0
    && value.every(file => !!fileIsUploaded(file))
}

const FormContent = ({
  nodeName,
  data,
  showBackButton,
  handleBack,
  onSubmit,
}: Props) => {
  const { t } = useTranslation()
  const defaultInputs = initializeInputs(data.inputs, data.resolved_default_values || {})
  const contentList = splitByOutputVar(data.form_content)
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = (name: string, value: HumanInputFieldValue) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const hasEmptySelectOrFileInput = data.inputs.some((input) => {
    const value = inputs[input.output_variable_name]

    if (isSelectFormInput(input))
      return typeof value !== 'string' || value.length === 0

    if (isFileFormInput(input))
      return Array.isArray(value) ? !hasUploadedFiles(value) : !isUploadedFile(value)

    if (isFileListFormInput(input))
      return !hasUploadedFiles(value)

    return false
  })

  const submit = async (actionID: string) => {
    setIsSubmitting(true)
    await onSubmit?.({ inputs, action: actionID })
    setIsSubmitting(false)
  }

  return (
    <>
      {showBackButton && (
        <div className="flex items-center p-4 pb-1">
          <div className="flex cursor-pointer items-center system-sm-semibold-uppercase text-text-accent" onClick={handleBack}>
            <RiArrowLeftLine className="mr-1 h-4 w-4" />
            {t('nodes.humanInput.singleRun.back', { ns: 'workflow' })}
          </div>
          <div className="mx-1 system-xs-regular text-divider-deep">/</div>
          <div className="system-sm-semibold-uppercase text-text-secondary">{nodeName}</div>
        </div>
      )}
      <div className="px-4 py-3">
        {contentList.map((content, index) => (
          <ContentItem
            key={index}
            content={content}
            formInputFields={data.inputs}
            inputs={inputs}
            onInputChange={handleInputsChange}
          />
        ))}
        <div className="flex flex-wrap gap-1 py-1">
          {data.actions.map((action: UserAction) => (
            <Button
              key={action.id}
              disabled={isSubmitting || hasEmptySelectOrFileInput}
              variant={getButtonStyle(action.button_style) as ButtonProps['variant']}
              onClick={() => submit(action.id)}
            >
              {action.title}
            </Button>
          ))}
        </div>
      </div>
    </>
  )
}

export default React.memo(FormContent)
