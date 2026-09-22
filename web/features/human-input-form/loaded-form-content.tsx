import type { ReactNode } from 'react'
import type { HumanInputFormDefinition } from './types'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import { Inter } from 'next/font/google'
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

const formFont = Inter({ subsets: ['latin'], display: 'swap' })

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
    <div
      className={cn(
        'size-full [scrollbar-gutter:stable_both-edges] overflow-y-auto',
        formFont.className,
      )}
    >
      <div className="mx-auto w-full max-w-180 px-4 py-4 sm:px-6">
        {branding && (
          <div className="flex w-full items-center gap-3 py-3">
            <AppIcon
              size="small"
              iconType={branding.site.icon_type}
              icon={branding.site.icon}
              background={branding.site.icon_background}
              imageUrl={branding.site.icon_url}
            />
            <div className="grow system-xl-semibold text-text-primary">{branding.site.title}</div>
          </div>
        )}
        <div className="relative rounded-[20px] bg-chat-bubble-bg p-4 shadow-lg backdrop-blur-xs before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border-t before:border-divider-subtle">
          <div
            className={cn(
              'flex flex-col gap-3 px-2 py-1',
              // Keep standalone typography local; chat still uses its compact rendering.
              '[&_.markdown-body]:tracking-[-0.005em] [&_.markdown-body>div]:flex [&_.markdown-body>div]:flex-col [&_.markdown-body>div]:gap-3 [&_.markdown-body>div>*]:my-0!',
              '[&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:m-0! [&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:pt-3 [&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:leading-[1.2] [&_.markdown-body_:is(h1,h2,h3,h4,h5,h6)]:tracking-normal',
              '[&_.markdown-body_:is(ul,ol)]:list-outside [&_.markdown-body_:is(ul,ol)]:pl-[22.5px]! [&_.markdown-body_li]:py-0 [&_.markdown-body>div>p+:is(ul,ol)]:-mt-3!',
              '[&_.markdown-img-wrapper_img]:m-0! [&_.markdown-img-wrapper_img]:box-border! [&_.markdown-img-wrapper_img]:h-auto [&_.markdown-img-wrapper_img]:max-h-none! [&_.markdown-img-wrapper_img]:w-full [&_.markdown-img-wrapper_img]:border-0! [&_.markdown-img-wrapper_img]:shadow-xs [&_.markdown-img-wrapper_img]:outline-2 [&_.markdown-img-wrapper_img]:outline-offset-[-2px] [&_.markdown-img-wrapper_img]:outline-effects-image-frame',
              '[&_textarea]:block [&_textarea]:h-28 [&_textarea]:rounded-[10px] [&_textarea]:border-0 [&_textarea]:px-4 [&_textarea]:text-[15px] [&_textarea]:leading-6 [&_textarea]:tracking-[-0.005em] [&_textarea:focus-visible]:ring-2 [&_textarea:focus-visible]:ring-components-input-border-active',
            )}
          >
            {contentList.map(({ key, content }) => (
              <div key={key} className="[&>div:not(.markdown-body)]:py-0">
                <ContentItem
                  content={content}
                  formInputFields={definition.inputs}
                  inputs={inputs}
                  onInputChange={handleInputsChange}
                />
              </div>
            ))}
            {verificationContent}
            <div>
              <div className="flex flex-wrap gap-1 py-1">
                {definition.actions.map((action) => (
                  <Button
                    key={action.id}
                    disabled={isActionDisabled}
                    variant={getButtonStyle(action.button_style)}
                    onClick={() => submit(action.id)}
                  >
                    {action.title}
                  </Button>
                ))}
              </div>
              <div className="[&_.i-ri-time-line]:hidden">
                <ExpirationTime expirationTime={definition.expirationTime * 1000} />
              </div>
            </div>
          </div>
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
