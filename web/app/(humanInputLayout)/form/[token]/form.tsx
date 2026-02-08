'use client'
import type { ButtonProps } from '@/app/components/base/button'
import type { FormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { SiteInfo } from '@/models/share'
import type { HumanInputFormError } from '@/service/use-share'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInformation2Fill,
} from '@remixicon/react'
import { produce } from 'immer'
import { useParams } from 'next/navigation'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import Loading from '@/app/components/base/loading'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import useDocumentTitle from '@/hooks/use-document-title'
import { useGetHumanInputForm, useSubmitHumanInputForm } from '@/service/use-share'
import { cn } from '@/utils/classnames'

export type FormData = {
  site: { site: SiteInfo }
  form_content: string
  inputs: FormInputItem[]
  resolved_default_values: Record<string, string>
  user_actions: UserAction[]
  expiration_time: number
}

const FormContent = () => {
  const { t } = useTranslation()

  const { token } = useParams<{ token: string }>()
  useDocumentTitle('')

  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)

  const { mutate: submitForm, isPending: isSubmitting } = useSubmitHumanInputForm()

  const { data: formData, isLoading, error } = useGetHumanInputForm(token)

  const expired = (error as HumanInputFormError | null)?.code === 'human_input_form_expired'
  const submitted = (error as HumanInputFormError | null)?.code === 'human_input_form_submitted'
  const rateLimitExceeded = (error as HumanInputFormError | null)?.code === 'web_form_rate_limit_exceeded'

  const splitByOutputVar = (content: string): string[] => {
    const outputVarRegex = /(\{\{#\$output\.[^#]+#\}\})/g
    const parts = content.split(outputVarRegex)
    return parts.filter(part => part.length > 0)
  }

  const contentList = useMemo(() => {
    if (!formData?.form_content)
      return []
    return splitByOutputVar(formData.form_content)
  }, [formData?.form_content])

  useEffect(() => {
    if (!formData?.inputs)
      return
    const initialInputs: Record<string, string> = {}
    formData.inputs.forEach((item) => {
      initialInputs[item.output_variable_name] = item.default.type === 'variable' ? formData.resolved_default_values[item.output_variable_name] || '' : item.default.value
    })
    setInputs(initialInputs)
  }, [formData?.inputs, formData?.resolved_default_values])

  // use immer
  const handleInputsChange = (name: string, value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft[name] = value
    })
    setInputs(newInputs)
  }

  const submit = (actionID: string) => {
    submitForm(
      { token, data: { inputs, action: actionID } },
      {
        onSuccess: () => {
          setSuccess(true)
        },
      },
    )
  }

  if (isLoading) {
    return (
      <Loading type="app" />
    )
  }

  if (success) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="min-w-[480px] max-w-[640px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm">
            <div className="h-[56px] w-[56px] shrink-0 rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiCheckboxCircleFill className="h-8 w-8 text-text-success" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.thanks', { ns: 'share' })}</div>
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.recorded', { ns: 'share' })}</div>
            </div>
            <div className="system-2xs-regular-uppercase shrink-0 text-text-tertiary">{t('humanInput.submissionID', { id: token, ns: 'share' })}</div>
          </div>
          <div className="flex flex-row-reverse px-2 py-3">
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              <DifyLogo size="small" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="min-w-[480px] max-w-[640px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiInformation2Fill className="h-8 w-8 text-text-accent" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.sorry', { ns: 'share' })}</div>
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.expired', { ns: 'share' })}</div>
            </div>
            <div className="system-2xs-regular-uppercase shrink-0 text-text-tertiary">{t('humanInput.submissionID', { id: token, ns: 'share' })}</div>
          </div>
          <div className="flex flex-row-reverse px-2 py-3">
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              <DifyLogo size="small" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="min-w-[480px] max-w-[640px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiInformation2Fill className="h-8 w-8 text-text-accent" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.sorry', { ns: 'share' })}</div>
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.completed', { ns: 'share' })}</div>
            </div>
            <div className="system-2xs-regular-uppercase shrink-0 text-text-tertiary">{t('humanInput.submissionID', { id: token, ns: 'share' })}</div>
          </div>
          <div className="flex flex-row-reverse px-2 py-3">
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              <DifyLogo size="small" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (rateLimitExceeded) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="min-w-[480px] max-w-[640px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiErrorWarningFill className="h-8 w-8 text-text-destructive" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.rateLimitExceeded', { ns: 'share' })}</div>
            </div>
          </div>
          <div className="flex flex-row-reverse px-2 py-3">
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              <DifyLogo size="small" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!formData) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="min-w-[480px] max-w-[640px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-sm">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiErrorWarningFill className="h-8 w-8 text-text-destructive" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.formNotFound', { ns: 'share' })}</div>
            </div>
          </div>
          <div className="flex flex-row-reverse px-2 py-3">
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-1',
            )}
            >
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
              <DifyLogo size="small" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const site = formData.site.site

  return (
    <div className={cn('mx-auto flex h-full w-full max-w-[720px] flex-col items-center')}>
      <div className="mt-4 flex w-full shrink-0 items-center gap-3 py-3">
        <AppIcon
          size="large"
          iconType={site.icon_type}
          icon={site.icon}
          background={site.icon_background}
          imageUrl={site.icon_url}
        />
        <div className="system-xl-semibold grow text-text-primary">{site.title}</div>
      </div>
      <div className="h-0 w-full grow overflow-y-auto">
        <div className="border-components-divider-subtle rounded-[20px] border bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-sm">
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
            {formData.user_actions.map((action: UserAction) => (
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
          <ExpirationTime expirationTime={formData.expiration_time * 1000} />
        </div>
        <div className="flex flex-row-reverse px-2 py-3">
          <div className={cn(
            'flex shrink-0 items-center gap-1.5 px-1',
          )}
          >
            <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
            <DifyLogo size="small" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(FormContent)
