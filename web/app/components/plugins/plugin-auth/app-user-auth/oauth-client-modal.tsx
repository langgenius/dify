import type { OAuthClientDraft } from './draft'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

type OAuthClientModalProps = {
  client?: OAuthClientDraft
  defaultClientAvailable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete: () => void
  onSave: (client: OAuthClientDraft) => void
}

const optionClassName =
  'min-h-9 flex-1 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-center system-sm-regular text-text-secondary data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:text-text-primary data-checked:inset-ring-[0.5px] data-checked:inset-ring-components-option-card-option-selected-border data-disabled:cursor-not-allowed data-disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden'

const OAuthClientModal = ({
  client,
  defaultClientAvailable,
  open,
  onOpenChange,
  onCloseComplete,
  onSave,
}: OAuthClientModalProps) => {
  const { t } = useTranslation(['plugin', 'common'])
  const clientLabelId = useId()
  const [clientType, setClientType] = useState(
    client?.type || (defaultClientAvailable ? 'default' : 'custom'),
  )
  const [clientId, setClientId] = useState(client?.type === 'custom' ? client.clientId : '')
  const [clientSecret, setClientSecret] = useState(
    client?.type === 'custom' ? client.clientSecret : '',
  )
  const [submitted, setSubmitted] = useState(false)
  const clientIdInvalid = submitted && !clientId.trim()
  const clientSecretInvalid = submitted && !clientSecret.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onCloseComplete()
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
            if (clientType === 'custom' && (!clientId.trim() || !clientSecret.trim())) return
            onSave(
              clientType === 'default'
                ? { type: 'default' }
                : { type: 'custom', clientId: clientId.trim(), clientSecret },
            )
            onOpenChange(false)
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['auth.oauthClientSettings'], { ns: 'plugin' })}
            </DialogTitle>
            <DialogClose
              render={
                <IconButton
                  type="button"
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          </div>
          <div className="space-y-2">
            <div id={clientLabelId} className="system-sm-medium text-text-secondary">
              {t(($) => $['auth.oauthClient'], { ns: 'plugin' })}
            </div>
            <RadioGroup
              aria-labelledby={clientLabelId}
              value={clientType}
              onValueChange={setClientType}
              className="flex gap-3"
            >
              <RadioItem
                value="default"
                disabled={!defaultClientAvailable}
                className={optionClassName}
              >
                {t(($) => $['auth.default'], { ns: 'plugin' })}
              </RadioItem>
              <RadioItem value="custom" className={optionClassName}>
                {t(($) => $['auth.custom'], { ns: 'plugin' })}
              </RadioItem>
            </RadioGroup>
            {!defaultClientAvailable && (
              <p className="body-xs-regular text-text-tertiary">
                {t(($) => $['auth.appUser.defaultClientUnavailable'], { ns: 'plugin' })}
              </p>
            )}
          </div>
          {clientType === 'custom' && (
            <>
              <p className="rounded-xl bg-background-section-burn p-4 system-sm-regular text-text-secondary">
                {t(($) => $['auth.appUser.customClientDescription'], { ns: 'plugin' })}
              </p>
              <Field name="clientId" invalid={clientIdInvalid} validationMode="onSubmit">
                <FieldLabel>
                  {t(($) => $['auth.appUser.clientId'], { ns: 'plugin' })}
                  <span aria-hidden className="ml-1 text-text-destructive-secondary">
                    *
                  </span>
                </FieldLabel>
                <Input
                  value={clientId}
                  onValueChange={setClientId}
                  required
                  autoComplete="off"
                  placeholder={t(($) => $['auth.appUser.clientIdPlaceholder'], { ns: 'plugin' })}
                />
                <FieldError match={clientIdInvalid}>
                  {t(($) => $['errorMsg.fieldRequired'], {
                    ns: 'common',
                    field: t(($) => $['auth.appUser.clientId'], { ns: 'plugin' }),
                  })}
                </FieldError>
              </Field>
              <Field name="clientSecret" invalid={clientSecretInvalid} validationMode="onSubmit">
                <FieldLabel>
                  {t(($) => $['auth.appUser.clientSecret'], { ns: 'plugin' })}
                  <span aria-hidden className="ml-1 text-text-destructive-secondary">
                    *
                  </span>
                </FieldLabel>
                <Input
                  type="password"
                  value={clientSecret}
                  onValueChange={setClientSecret}
                  required
                  autoComplete="off"
                  placeholder={t(($) => $['auth.appUser.clientSecretPlaceholder'], {
                    ns: 'plugin',
                  })}
                />
                <FieldError match={clientSecretInvalid}>
                  {t(($) => $['errorMsg.fieldRequired'], {
                    ns: 'common',
                    field: t(($) => $['auth.appUser.clientSecret'], { ns: 'plugin' }),
                  })}
                </FieldError>
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose render={<Button type="button" variant="secondary" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button type="submit" variant="primary">
              {t(($) => $['auth.saveOnly'], { ns: 'plugin' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default OAuthClientModal
