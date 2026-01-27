'use client'
import type { ButtonProps } from '@/app/components/base/button'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
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
          <div className="system-sm-semibold-uppercase flex cursor-pointer items-center text-text-accent" onClick={handleBack}>
            <RiArrowLeftLine className="mr-1 h-4 w-4" />
            {t('nodes.humanInput.singleRun.back', { ns: 'workflow' })}
          </div>
          <div className="system-xs-regular mx-1 text-divider-deep">/</div>
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
