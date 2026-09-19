'use client'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@langgenius/dify-ui/breadcrumb'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import {
  getButtonStyle,
  getRenderedFormInputs,
  hasInvalidSelectOrFileInput,
  initializeInputs,
  splitByOutputVar,
} from '@/app/components/base/chat/chat/answer/human-input-content/utils'

type Props = Readonly<{
  nodeName: string
  data: HumanInputFormData
  showBackButton?: boolean
  handleBack?: () => void
  onSubmit?: ({
    inputs,
    action,
  }: {
    inputs: Record<string, HumanInputFieldValue>
    action: string
  }) => Promise<void>
}>

const FormContent = ({ nodeName, data, showBackButton, handleBack, onSubmit }: Props) => {
  const { t } = useTranslation()
  const contentList = splitByOutputVar(data.form_content)
  const renderedFormInputs = getRenderedFormInputs(data.inputs, data.form_content)
  const defaultInputs = initializeInputs(renderedFormInputs, data.resolved_default_values || {})
  const [inputs, setInputs] = useState(defaultInputs)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputsChange = (name: string, value: HumanInputFieldValue) => {
    setInputs((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const hasEmptySelectOrFileInput = hasInvalidSelectOrFileInput(renderedFormInputs, inputs)

  const submit = async (actionID: string) => {
    setIsSubmitting(true)
    await onSubmit?.({ inputs, action: actionID })
    setIsSubmitting(false)
  }

  return (
    <>
      {showBackButton && (
        <Breadcrumb aria-label={nodeName} className="p-4 pb-1">
          <BreadcrumbList className="gap-0">
            <BreadcrumbItem className="shrink-0">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded-sm text-left system-sm-semibold-uppercase text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={handleBack}
              >
                <span className="i-ri-arrow-left-line size-4" aria-hidden />
                {t(($) => $['nodes.humanInput.singleRun.back'], { ns: 'workflow' })}
              </button>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="mx-1 system-xs-regular text-divider-deep" />
            <BreadcrumbItem>
              <BreadcrumbPage
                aria-current="location"
                className="system-sm-semibold-uppercase wrap-anywhere whitespace-normal text-text-secondary"
              >
                {nodeName}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
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
              variant={getButtonStyle(action.button_style)}
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
