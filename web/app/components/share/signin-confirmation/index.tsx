'use client'

import type { WebSiteResponse } from '@dify/contracts/api/web/types.gen'
import type { AppIconProps } from '@/app/components/base/app-icon'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

export type ConversationOwnershipChoice = 'add' | 'delete'

type SignInConfirmationProps = {
  email: string
  conversationCount: number
  app: Pick<
    WebSiteResponse,
    'title' | 'description' | 'icon' | 'icon_type' | 'icon_background' | 'icon_url'
  >
  iconFallback?: AppIconProps['fallback']
  onConfirm?: (choice: ConversationOwnershipChoice) => void
  onSwitchAccount?: () => void
}

export default function SignInConfirmation({
  email,
  conversationCount,
  app,
  iconFallback,
  onConfirm,
  onSwitchAccount,
}: SignInConfirmationProps) {
  const { t } = useTranslation(['login'])
  const [choice, setChoice] = useState<ConversationOwnershipChoice | null>(null)
  const id = useId()
  const options = [
    {
      value: 'add',
      title: t(($) => $['history.add'], { ns: 'login' }),
      description: t(($) => $['history.addDescription'], { ns: 'login' }),
    },
    {
      value: 'delete',
      title: t(($) => $['history.delete'], { ns: 'login' }),
      description: t(($) => $['history.deleteDescription'], { ns: 'login' }),
    },
  ] satisfies Array<{ value: ConversationOwnershipChoice; title: string; description: string }>

  return (
    <div className="grid w-full max-w-130 items-center gap-8 lg:min-h-150 lg:max-w-265 lg:grid-cols-[minmax(0,520px)_1px_minmax(0,1fr)] lg:gap-12">
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (choice) onConfirm?.(choice)
        }}
      >
        <p className="body-md-regular wrap-anywhere text-text-tertiary">
          {t(($) => $['history.signedInAs'], { ns: 'login', email })}
        </p>
        <Field name="conversationOwnership" className="gap-0">
          <Fieldset className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 pt-3 pb-4">
              <FieldsetLegend
                id={`${id}-title`}
                render={<h1>{t(($) => $['history.title'], { ns: 'login' })}</h1>}
                className="m-0 p-0 title-4xl-semi-bold text-text-primary"
              />
              <p id={`${id}-description`} className="body-md-regular text-text-tertiary">
                {t(($) => $['history.description'], {
                  ns: 'login',
                  count: conversationCount,
                  appName: app.title,
                })}
              </p>
            </div>
            <RadioGroup<ConversationOwnershipChoice | null>
              value={choice}
              onValueChange={setChoice}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-description`}
              className="flex-col items-stretch gap-3"
            >
              {options.map((option) => (
                <FieldItem key={option.value}>
                  <RadioItem<ConversationOwnershipChoice>
                    value={option.value}
                    nativeButton
                    render={<button type="button" />}
                    aria-labelledby={`${id}-${option.value}-title`}
                    aria-describedby={`${id}-${option.value}-description`}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4 text-start hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-2 focus-visible:outline-hidden data-checked:ring-1',
                      option.value === 'delete'
                        ? 'data-checked:border-components-button-destructive-primary-bg data-checked:ring-components-button-destructive-primary-bg'
                        : 'data-checked:border-components-button-primary-bg data-checked:ring-components-button-primary-bg',
                    )}
                  >
                    <RadioControl aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        id={`${id}-${option.value}-title`}
                        className="system-md-semibold text-text-primary"
                      >
                        {option.title}
                      </span>
                      <span
                        id={`${id}-${option.value}-description`}
                        className={cn(
                          'body-md-regular wrap-anywhere text-text-tertiary',
                          option.value === 'delete' && 'min-h-10',
                        )}
                      >
                        {option.description}
                      </span>
                    </span>
                  </RadioItem>
                </FieldItem>
              ))}
            </RadioGroup>
          </Fieldset>
        </Field>
        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={!choice}
            variant="primary"
            size="large"
            tone={choice === 'delete' ? 'destructive' : 'default'}
            className="h-auto min-h-9 w-full py-2 whitespace-normal"
          >
            {choice === 'delete'
              ? t(($) => $['history.deleteAndContinue'], { ns: 'login' })
              : choice === 'add'
                ? t(($) => $['history.addAndContinue'], { ns: 'login' })
                : t(($) => $['history.continue'], { ns: 'login' })}
          </Button>
          <Button
            type="button"
            size="small"
            variant="ghost"
            className="h-auto min-h-6 w-full py-1 whitespace-normal text-text-accent"
            onClick={onSwitchAccount}
          >
            {t(($) => $['history.useDifferentAccount'], { ns: 'login' })}
          </Button>
        </div>
      </form>
      <div
        aria-hidden="true"
        className="hidden h-150 w-px bg-linear-to-b from-transparent via-divider-subtle to-transparent lg:block"
      />
      <div className="flex min-w-0 flex-col gap-3 border-t border-divider-subtle pt-8 lg:border-0 lg:px-8 lg:pt-0">
        <AppIcon size="large" icon={app} fallback={iconFallback} className="shadow-xs" />
        <div className="flex flex-col gap-2">
          <h2 className="system-md-semibold wrap-anywhere text-text-primary">{app.title}</h2>
          {app.description && (
            <p className="system-xs-regular wrap-anywhere text-text-tertiary">{app.description}</p>
          )}
        </div>
      </div>
    </div>
  )
}
