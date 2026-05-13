'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { RiArrowLeftLine } from '@remixicon/react'

import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import { getButtonStyle, initializeInputs, splitByOutputVar } from '@/app/components/base/chat/chat/answer/human-input-content/utils'

type Props = {
  nodeName: string
  data: HumanInputFormData
  showBackButton?: boolean
  handleBack?: () => void
  onSubmit?: ({ inputs, action }: { inputs: Record<string, string>, action: string }) => Promise<void>
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

  const handleInputsChange = (name: string, value: string) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const submit = async (actionID: string) => {
    setIsSubmitting(true)
    await onSubmit?.({ inputs, action: actionID })
    setIsSubmitting(false)
  }

  return (
    <>
      {showBackButton && (
        <div className="flex items-center p-4 pb-1">
          <button
            type="button"
            className="flex cursor-pointer items-center border-none bg-transparent p-0 text-left system-sm-semibold-uppercase text-text-accent"
            onClick={handleBack}
          >
            <RiArrowLeftLine className="mr-1 h-4 w-4" aria-hidden />
            {t('nodes.humanInput.singleRun.back', { ns: 'workflow' })}
          </button>
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
              disabled={isSubmitting}
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
