import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { FormData } from './form'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import { getButtonStyle, hasInvalidRequiredHumanInput, initializeInputs, splitByOutputVar } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import DifyLogo from '@/app/components/base/logo/dify-logo'

type LoadedFormContentProps = {
  formData: FormData
  isSubmitting: boolean
  onSubmit: (inputs: Record<string, HumanInputFieldValue>, actionID: string) => void
}

const LoadedFormContent = ({
  formData,
  isSubmitting,
  onSubmit,
}: LoadedFormContentProps) => {
  const { t } = useTranslation()
  const [inputs, setInputs] = useState<Record<string, HumanInputFieldValue>>(() =>
    initializeInputs(formData.inputs, formData.resolved_default_values),
  )

  const contentList = useMemo(() => {
    return splitByOutputVar(formData.form_content)
  }, [formData.form_content])

  const handleInputsChange = (name: string, value: HumanInputFieldValue) => {
    setInputs(prevInputs => produce(prevInputs, (draft) => {
      draft[name] = value
    }))
  }

  const submit = (actionID: string) => {
    onSubmit(inputs, actionID)
  }

  const isActionDisabled = isSubmitting || hasInvalidRequiredHumanInput(formData.inputs, inputs)
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
        <div className="grow system-xl-semibold text-text-primary">{site.title}</div>
      </div>
      <div className="h-0 w-full grow overflow-y-auto">
        <div className="rounded-[20px] border border-divider-subtle bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-xs">
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
                disabled={isActionDisabled}
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
          <div className="flex shrink-0 items-center gap-1.5 px-1">
            <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
            <DifyLogo size="small" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoadedFormContent
