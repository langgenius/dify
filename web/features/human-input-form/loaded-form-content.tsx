import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { ReactNode } from 'react'
import type { HumanInputFormDefinition } from './types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import { Button } from '@langgenius/dify-ui/button'
import { produce } from 'immer'
import { useMemo, useState } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import ContentItem from '@/app/components/base/chat/chat/answer/human-input-content/content-item'
import ExpirationTime from '@/app/components/base/chat/chat/answer/human-input-content/expiration-time'
import {
  getButtonStyle,
  getProcessedHumanInputFormInputs,
  getRenderedFormInputs,
  hasInvalidRequiredHumanInput,
  initializeInputs,
  splitByOutputVar,
} from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import BrandingFooter from './branding-footer'

type LoadedFormContentProps = {
  definition: HumanInputFormDefinition
  isSubmitting: boolean
  actionsDisabled?: boolean
  verificationContent?: ReactNode
  onSubmit: (inputs: Record<string, unknown>, actionID: string) => void
}

const LoadedFormContent = ({
  definition,
  isSubmitting,
  actionsDisabled = false,
  verificationContent,
  onSubmit,
}: LoadedFormContentProps) => {
  const renderedFormInputs = getRenderedFormInputs(definition.inputs, definition.formContent)
  const [inputs, setInputs] = useState<Record<string, HumanInputFieldValue>>(() =>
    initializeInputs(renderedFormInputs, definition.resolvedDefaultValues),
  )

  const contentList = useMemo(() => {
    const contentCounts = new Map<string, number>()

    return splitByOutputVar(definition.formContent).map((content) => {
      const occurrence = (contentCounts.get(content) || 0) + 1
      contentCounts.set(content, occurrence)
      return { key: `${content}-${occurrence}`, content }
    })
  }, [definition.formContent])

  const handleInputsChange = (name: string, value: HumanInputFieldValue) => {
    setInputs((prevInputs) =>
      produce(prevInputs, (draft) => {
        draft[name] = value
      }),
    )
  }

  const submit = (actionID: string) => {
    onSubmit(getProcessedHumanInputFormInputs(definition.inputs, inputs) || {}, actionID)
  }

  const isActionDisabled =
    actionsDisabled || isSubmitting || hasInvalidRequiredHumanInput(renderedFormInputs, inputs)
  const branding = definition.branding
  const removeWebappBrand = branding?.customConfig?.remove_webapp_brand === true
  const replaceWebappLogo =
    typeof branding?.customConfig?.replace_webapp_logo === 'string'
      ? branding.customConfig.replace_webapp_logo
      : null

  return (
    <div className="mx-auto flex size-full max-w-180 flex-col items-center">
      {branding && (
        <div className="mt-4 flex w-full shrink-0 items-center gap-3 py-3">
          <AppIcon
            size="large"
            iconType={branding.site.icon_type}
            icon={branding.site.icon}
            background={branding.site.icon_background}
            imageUrl={branding.site.icon_url}
          />
          <div className="grow system-xl-semibold text-text-primary">{branding.site.title}</div>
        </div>
      )}
      <div className="h-0 w-full grow overflow-y-auto">
        <div className="rounded-[20px] border border-divider-subtle bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-xs">
          {contentList.map(({ key, content }) => (
            <ContentItem
              key={key}
              content={content}
              formInputFields={definition.inputs}
              inputs={inputs}
              onInputChange={handleInputsChange}
            />
          ))}
          {verificationContent}
          <div className="flex flex-wrap gap-1 py-1">
            {definition.actions.map((action) => (
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
          <ExpirationTime expirationTime={definition.expirationTime * 1000} />
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
