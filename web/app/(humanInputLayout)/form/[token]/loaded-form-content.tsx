import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { FormData } from './form'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { UserAction } from '@/app/components/workflow/nodes/human-input/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import { useMemo, useState } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import {
  getButtonStyle,
  getRenderedFormInputs,
  hasInvalidRequiredHumanInput,
  initializeInputs,
  splitByOutputVar,
} from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import BrandingFooter from './branding-footer'

type LoadedFormContentProps = {
  formData: FormData
  isSubmitting: boolean
  onSubmit: (
    inputs: Record<string, HumanInputFieldValue>,
    actionID: string,
    formInputs: FormData['inputs'],
  ) => void
  removeWebappBrand?: boolean
  replaceWebappLogo?: string | null
}

const LoadedFormContent = ({
  formData,
  isSubmitting,
  onSubmit,
  removeWebappBrand,
  replaceWebappLogo,
}: LoadedFormContentProps) => {
  const renderedFormInputs = getRenderedFormInputs(formData.inputs, formData.form_content)
  const [inputs, setInputs] = useState<Record<string, HumanInputFieldValue>>(() =>
    initializeInputs(renderedFormInputs, formData.resolved_default_values),
  )

  const contentList = useMemo(() => {
    const contentCounts = new Map<string, number>()

    return splitByOutputVar(formData.form_content).map((content) => {
      const occurrence = (contentCounts.get(content) || 0) + 1
      contentCounts.set(content, occurrence)

      return {
        key: `${content}-${occurrence}`,
        content,
      }
    })
  }, [formData.form_content])

  const handleInputsChange = (name: string, value: HumanInputFieldValue) => {
    setInputs((prevInputs) =>
      produce(prevInputs, (draft) => {
        draft[name] = value
      }),
    )
  }

  const submit = (actionID: string) => {
    onSubmit(inputs, actionID, formData.inputs)
  }

  const isActionDisabled = isSubmitting || hasInvalidRequiredHumanInput(renderedFormInputs, inputs)
  const site = formData.site.site

  return (
    <div className={cn('mx-auto flex size-full max-w-180 flex-col items-center')}>
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
          {contentList.map(({ key, content }) => (
            <ContentItem
              key={key}
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
        <BrandingFooter
          removeWebappBrand={removeWebappBrand}
          replaceWebappLogo={replaceWebappLogo}
        />
      </div>
    </div>
  )
}

export default LoadedFormContent
