'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowLeftLine } from '@remixicon/react'

import Button from '@/app/components/base/button'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import type { GeneratedFormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
// import cn from '@/utils/classnames'

type Props = {
  nodeName: string
  formContent: string
  inputFields: GeneratedFormInputItem[]
  userActions: UserAction[]
  handleBack?: () => void
}

const FormContent = ({
  nodeName,
  formContent,
  inputFields,
  userActions,
  handleBack,
}: Props) => {
  const { t } = useTranslation()

  const splitByOutputVar = (content: string): string[] => {
    const outputVarRegex = /({{#\$output\.[^#]+#}})/g
    const parts = content.split(outputVarRegex)
    return parts.filter(part => part.length > 0)
  }

  const initializeInputs = (formInputs: GeneratedFormInputItem[]) => {
    const initialInputs: Record<string, any> = {}
    formInputs.forEach((item) => {
      if (item.type === 'text-input' || item.type === 'paragraph')
        initialInputs[item.output_variable_name] = ''
      else
        initialInputs[item.output_variable_name] = undefined
    })
    return initialInputs
  }

  const contentList = splitByOutputVar(formContent)
  const defaultInputValues = initializeInputs(inputFields)
  const [inputs, setInputs] = useState(defaultInputValues)

  const getButtonStyle = (style: UserActionButtonType) => {
    if (style === UserActionButtonType.Primary)
      return 'primary'
    if (style === UserActionButtonType.Default)
      return 'secondary'
    if (style === UserActionButtonType.Accent)
      return 'secondary-accent'
    if (style === UserActionButtonType.Ghost)
      return 'ghost'
  }

  // use immer
  const handleInputsChange = (name: string, value: any) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const submit = async (actionID: string) => {
    // TODO
  }

  return (
    <>
      {inputFields.length > 0 && (
        <div className='flex items-center p-4 pb-1'>
          <div className='system-sm-semibold-uppercase flex cursor-pointer items-center text-text-accent' onClick={handleBack}>
            <RiArrowLeftLine className='mr-1 h-4 w-4' />
            {t('workflow.nodes.humanInput.singleRun.back')}
          </div>
          <div className='system-xs-regular mx-1 text-divider-deep'>/</div>
          <div className='system-sm-semibold-uppercase text-text-secondary'>{nodeName}</div>
        </div>
      )}
      <div className='px-4 py-3'>
        {contentList.map((content, index) => (
          <ContentItem
            key={index}
            content={content}
            formInputFields={inputFields}
            inputs={inputs}
            onInputChange={handleInputsChange}
          />
        ))}
        <div className='flex flex-wrap gap-1 py-1'>
          {userActions.map((action: any) => (
            <Button
              key={action.id}
              variant={getButtonStyle(action.button_style) as any}
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
