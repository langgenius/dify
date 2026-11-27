'use client'

import type { WebSiteResponse } from '@dify/contracts/api/web/types.gen'
import type { AppIconProps } from '@/app/components/base/app-icon'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldItem } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'

export type MigrationDataChoice = 'add' | 'continue' | 'delete'

type SignInConfirmationProps = {
  accountName: string
  supportsMigration?: boolean
  app: Pick<
    WebSiteResponse,
    'title' | 'description' | 'icon' | 'icon_type' | 'icon_background' | 'icon_url'
  >
  iconFallback?: AppIconProps['fallback']
  continueHref: string
  onConfirm?: (choice: MigrationDataChoice) => void
  onSwitchAccount?: () => void
  isSubmitting?: boolean
  isSwitchingAccount?: boolean
  actionError?: string
}

export default function SignInConfirmation({
  accountName,
  supportsMigration = true,
  app,
  iconFallback,
  continueHref,
  onConfirm,
  onSwitchAccount,
  isSubmitting = false,
  isSwitchingAccount = false,
  actionError,
}: SignInConfirmationProps) {
  const { t } = useTranslation(['login'])
  const [choice, setChoice] = useState<MigrationDataChoice | null>(
    supportsMigration ? 'add' : 'continue',
  )
  const id = useId()
  const busy = isSubmitting || isSwitchingAccount
  const addOption = {
    value: 'add',
    title: t(($) => $['history.add'], { ns: 'login' }),
    description: t(($) => $['history.addDescription'], { ns: 'login' }),
  } satisfies MigrationOption
  const continueOption = {
    value: 'continue',
    title: t(($) => $['history.continueWithoutAdding'], { ns: 'login' }),
    description: t(($) => $['history.continueWithoutAddingDescription'], { ns: 'login' }),
  } satisfies MigrationOption
  const deleteOption = {
    value: 'delete',
    title: t(($) => $['history.delete'], { ns: 'login' }),
    description: t(($) => $['history.deleteDescription'], { ns: 'login' }),
  } satisfies MigrationOption
  const options = supportsMigration ? [addOption, deleteOption] : [continueOption, deleteOption]

  const primaryLabel =
    choice === 'delete'
      ? t(($) => $['history.deleteAndContinue'], { ns: 'login' })
      : choice === 'add'
        ? t(($) => $['history.addAndContinue'], { ns: 'login' })
        : t(($) => $['history.continue'], { ns: 'login' })

  return (
    <div className="grid w-full max-w-130 items-center gap-8 lg:min-h-150 lg:max-w-265 lg:grid-cols-[minmax(0,520px)_1px_minmax(0,1fr)] lg:gap-12">
      <form
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (choice && !busy) onConfirm?.(choice)
        }}
      >
        <p className="body-md-regular wrap-anywhere text-text-tertiary">
          {t(($) => $['history.signedInAs'], { ns: 'login', email: accountName })}
        </p>
        <Field name="migrationDataOwnership" className="gap-0">
          <Fieldset className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 pt-3 pb-4">
              <FieldsetLegend
                id={`${id}-title`}
                render={<h1>{t(($) => $['history.title'], { ns: 'login' })}</h1>}
                className="m-0 p-0 title-4xl-semi-bold text-text-primary"
              />
              <p id={`${id}-description`} className="body-md-regular text-text-tertiary">
                {t(($) => $['history.description'], { ns: 'login', appName: app.title })}
              </p>
            </div>
            {!supportsMigration && (
              <div className="flex items-start gap-2 rounded-xl border border-divider-subtle bg-background-section p-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 i-ri-information-line size-4 shrink-0 text-text-tertiary"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="system-xs-semibold text-text-primary">
                    {t(($) => $['history.unsupportedTitle'], { ns: 'login' })}
                  </p>
                  <p className="system-xs-regular text-text-tertiary">
                    {t(($) => $['history.unsupportedDescription'], { ns: 'login' })}
                  </p>
                </div>
              </div>
            )}
            <RadioGroup<MigrationDataChoice | null>
              value={choice}
              onValueChange={setChoice}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-description`}
              className="flex-col items-stretch gap-3"
            >
              {options.map((option) => (
                <FieldItem key={option.value}>
                  <RadioItem<MigrationDataChoice>
                    value={option.value}
                    disabled={busy}
                    nativeButton
                    render={<button type="button" />}
                    aria-labelledby={`${id}-${option.value}-title`}
                    aria-describedby={
                      option.value === 'add'
                        ? `${id}-${option.value}-description ${id}-transfer-warning`
                        : `${id}-${option.value}-description`
                    }
                    className={cn(
                      'flex w-full items-start gap-3 rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 py-3.75 text-start hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-2 focus-visible:outline-hidden data-checked:ring-1 data-checked:ring-inset',
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
                      {option.value === 'add' && (
                        <span
                          id={`${id}-transfer-warning`}
                          role="note"
                          className="mt-2 rounded-lg border border-state-warning-active bg-state-warning-hover p-3 system-xs-regular wrap-anywhere text-text-warning"
                        >
                          {t(($) => $['history.transferWarning'], { ns: 'login' })}
                        </span>
                      )}
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
            disabled={!choice || !onConfirm || isSwitchingAccount}
            loading={isSubmitting}
            variant="primary"
            size="large"
            tone={choice === 'delete' ? 'destructive' : 'default'}
            className="h-auto min-h-9 w-full py-2 whitespace-normal"
          >
            {primaryLabel}
          </Button>
          {actionError && (
            <p role="alert" className="system-xs-regular text-text-destructive">
              {actionError}
            </p>
          )}
          {onSwitchAccount && (
            <Button
              variant="ghost"
              size="small"
              disabled={isSubmitting}
              loading={isSwitchingAccount}
              onClick={onSwitchAccount}
              className="h-auto min-h-6 w-full py-1 whitespace-normal text-text-accent hover:bg-transparent"
            >
              {t(($) => $['history.useDifferentAccount'], { ns: 'login' })}
            </Button>
          )}
          {supportsMigration &&
            (busy ? (
              <Button variant="ghost" size="small" disabled className="w-full">
                {t(($) => $['history.notNow'], { ns: 'login' })}
              </Button>
            ) : (
              <Link
                href={continueHref}
                replace
                prefetch={false}
                className={cn(
                  buttonVariants({ size: 'small', variant: 'ghost' }),
                  'h-auto min-h-6 w-full py-1 whitespace-normal text-text-tertiary',
                )}
              >
                {t(($) => $['history.notNow'], { ns: 'login' })}
              </Link>
            ))}
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

type MigrationOption = {
  value: MigrationDataChoice
  title: string
  description: string
}
