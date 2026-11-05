import type { resolveContactImCallbackSetup } from './provider-form-adapters'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'

type ContactImCallbackSetupProps = {
  callbackUrl: string
  providerName: string
  setup: ReturnType<typeof resolveContactImCallbackSetup>
  setupGuideUrl: string
  onBack: () => void
  onFinish: () => void
}

export function ContactImCallbackSetup({
  callbackUrl,
  providerName,
  setup,
  setupGuideUrl,
  onBack,
  onFinish,
}: ContactImCallbackSetupProps) {
  const { t } = useTranslation(['contacts'])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-4 overflow-y-auto px-6 py-3">
        <Field name="callbackUrl">
          <FieldLabel>{t(($) => $['imPlatform.bindingDialog.callback'])}</FieldLabel>
          <InputGroup>
            <InputGroupInput ref={inputRef} readOnly value={callbackUrl} />
            <InputGroupAddon align="inline-end">
              <CopyFeedback
                content={callbackUrl}
                copyLabel={t(($) => $['imPlatform.action.copyCallback'])}
                copiedLabel={t(($) => $['imPlatform.action.copied'])}
              />
            </InputGroupAddon>
          </InputGroup>
        </Field>

        {setup && (
          <div className="rounded-lg bg-background-default-subtle px-3 py-2.5 system-sm-regular text-text-secondary">
            <p>
              <Trans
                ns="contacts"
                i18nKey={($) =>
                  $[
                    `imPlatform.bindingDialog.callbackInstruction.${setup.instructionsKey}.destination`
                  ]
                }
                components={{
                  console: (
                    <a
                      className="rounded-sm font-medium text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                      href={setup.consoleUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {providerName}
                    </a>
                  ),
                }}
              />
            </p>
            <p className="mt-1 system-xs-regular">
              {t(
                ($) =>
                  $[`imPlatform.bindingDialog.callbackInstruction.${setup.instructionsKey}.path`],
              )}
            </p>
          </div>
        )}
      </div>

      <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-6">
        <a
          className="inline-flex items-center gap-1 rounded-sm system-xs-regular text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          href={setupGuideUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t(($) => $['imPlatform.bindingDialog.viewSetupGuide'])}
          <span aria-hidden className="i-ri-external-link-line size-3" />
        </a>
        <div className="ms-auto flex gap-2">
          <Button className="min-w-18" onClick={onBack}>
            {t(($) => $['imPlatform.bindingDialog.back'])}
          </Button>
          <Button className="min-w-18" variant="primary" onClick={onFinish}>
            {t(($) => $['imPlatform.bindingDialog.finish'])}
          </Button>
        </div>
      </div>
    </div>
  )
}
