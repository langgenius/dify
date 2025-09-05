'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from 'next/navigation'
import {
  RiCheckboxCircleFill,
  RiInformation2Fill,
} from '@remixicon/react'
import Loading from '@/app/components/base/loading'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import type { GeneratedFormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import { getHumanInputForm, submitHumanInputForm } from '@/service/share'
import { asyncRunSafe } from '@/utils'
import cn from '@/utils/classnames'

export type FormData = {
  site: any
  form_content: string
  inputs: GeneratedFormInputItem[]
  user_actions: UserAction[]
  timeout: number
  timeout_unit: 'hour' | 'day'
}

const FormContent = () => {
  const { t } = useTranslation()

  const { token } = useParams<{ token: string }>()
  useDocumentTitle('')

  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<FormData>()
  const [contentList, setContentList] = useState<string[]>([])
  const [inputs, setInputs] = useState({})
  const [success, setSuccess] = useState(false)
  const [expired, setExpired] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const site = formData?.site.site

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
    setInputs(initialInputs)
  }

  const initializeContentList = (formContent: string) => {
    const parts = splitByOutputVar(formContent)
    setContentList(parts)
  }

  // use immer
  const handleInputsChange = (name: string, value: any) => {
    setInputs(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const getForm = async (token: string) => {
    try {
      const data = await getHumanInputForm(token)
      setFormData(data)
      initializeInputs(data.inputs)
      initializeContentList(data.form_content)
      setIsLoading(false)
    }
    catch (error) {
      console.error(error)
    }
  }

  const submit = async (actionID: string) => {
    setIsSubmitting(true)
    try {
      await submitHumanInputForm(token, { inputs, action: actionID })
      setSuccess(true)
    }
    catch (e: any) {
      if (e.status === 400) {
        const [, errRespData] = await asyncRunSafe<{ error_code: string }>(e.json())
        const { error_code } = errRespData || {}
        if (error_code === 'human_input_form_expired')
          setExpired(true)
        if (error_code === 'human_input_form_submitted')
          setSubmitted(true)
      }
    }
    finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    getForm(token)
  }, [token])

  if (isLoading || !formData) {
    return (
      <Loading type='app' />
    )
  }

  if (success) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiCheckboxCircleFill className='h-8 w-8 text-text-success' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.thanks')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.recorded')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiInformation2Fill className='h-8 w-8 text-text-accent' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.sorry')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.expired')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className='min-w-[480px] max-w-[640px]'>
          <div className='border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm'>
            <div className='h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3'>
              <RiInformation2Fill className='h-8 w-8 text-text-accent' />
            </div>
            <div className='grow'>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.sorry')}</div>
              <div className='title-4xl-semi-bold text-text-primary'>{t('share.humanInput.completed')}</div>
            </div>
            <div className='system-2xs-regular-uppercase shrink-0 text-text-tertiary'>{t('share.humanInput.submissionID', { id: token })}</div>
          </div>
          <div className='flex flex-row-reverse px-2 py-3'>
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              <DifyLogo size='small' />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('mx-auto flex h-full w-full max-w-[720px] flex-col items-center')}>
      <div className='mt-4 flex w-full shrink-0 items-center gap-3 py-3'>
        <AppIcon
          size='large'
          iconType={site.icon_type as any}
          icon={site.icon}
          background={site.icon_background}
          imageUrl={site.icon_url}
        />
        <div className='system-xl-semibold grow text-text-primary'>{site.title}</div>
      </div>
      <div className='h-0 w-full grow overflow-y-auto'>
        <div className='border-components-divider-subtle rounded-[20px] border bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-sm'>
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
                onClick={() => submit(action.id)}
              >
                {action.title}
              </Button>
            ))}
          </div>
          <div className='system-xs-regular mt-1 text-text-tertiary'>
            {formData.timeout_unit === 'day' ? t('share.humanInput.timeoutDay', { count: formData.timeout }) : t('share.humanInput.timeoutHour', { count: formData.timeout })}
          </div>
        </div>
        <div className='flex flex-row-reverse px-2 py-3'>
          <div className={cn(
            'flex shrink-0 items-center gap-1.5 px-1',
          )}>
            <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
            <DifyLogo size='small' />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(FormContent)
