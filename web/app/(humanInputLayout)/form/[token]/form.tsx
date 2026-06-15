'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { FormInputItem, UserAction } from '@/app/components/workflow/nodes/human-input/types'
import type { CustomConfigValueType, SiteInfo } from '@/models/share'
import type { HumanInputFormError } from '@/service/use-share'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInformation2Fill,
} from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import Loading from '@/app/components/base/loading'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import useDocumentTitle from '@/hooks/use-document-title'
import { useParams } from '@/next/navigation'
import { useGetHumanInputForm, useSubmitHumanInputForm } from '@/service/use-share'

export type FormData = {
  site: {
    site: SiteInfo
    custom_config?: Record<string, CustomConfigValueType> | null
  }
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

  const removeWebappBrand = formData?.site?.custom_config?.remove_webapp_brand === true
  const replaceWebappLogo = typeof formData?.site?.custom_config?.replace_webapp_logo === 'string'
    ? formData.site.custom_config.replace_webapp_logo
    : null

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
      <FormStatusCard
        iconClassName="i-ri-checkbox-circle-fill text-text-success"
        title={t('humanInput.thanks', { ns: 'share' })}
        subtitle={t('humanInput.recorded', { ns: 'share' })}
        submissionID={token}
        removeWebappBrand={removeWebappBrand}
        replaceWebappLogo={replaceWebappLogo}
      />
    )
  }

  if (expired) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center')}>
        <div className="max-w-[640px] min-w-[480px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiInformation2Fill className="h-8 w-8 text-text-accent" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.sorry', { ns: 'share' })}</div>
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.expired', { ns: 'share' })}</div>
            </div>
            <div className="shrink-0 system-2xs-regular-uppercase text-text-tertiary">{t('humanInput.submissionID', { id: token, ns: 'share' })}</div>
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
        <div className="max-w-[640px] min-w-[480px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge p-3">
              <RiInformation2Fill className="h-8 w-8 text-text-accent" />
            </div>
            <div className="grow">
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.sorry', { ns: 'share' })}</div>
              <div className="title-4xl-semi-bold text-text-primary">{t('humanInput.completed', { ns: 'share' })}</div>
            </div>
            <div className="shrink-0 system-2xs-regular-uppercase text-text-tertiary">{t('humanInput.submissionID', { id: token, ns: 'share' })}</div>
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
        <div className="max-w-[640px] min-w-[480px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
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
        <div className="max-w-[640px] min-w-[480px]">
          <div className="border-components-divider-subtle flex h-[320px] flex-col gap-4 rounded-[20px] border bg-chat-bubble-bg p-10 pb-9 shadow-lg backdrop-blur-xs">
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
    <LoadedFormContent
      key={token}
      formData={formData}
      isSubmitting={isSubmitting}
      onSubmit={submit}
      removeWebappBrand={removeWebappBrand}
      replaceWebappLogo={replaceWebappLogo}
    />
  )
}

export default React.memo(FormContent)
