import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import type { ExternalAgentOverviewPreview } from '../preview'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel, FieldValidity } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

function ConnectionSettingsForm({
  preview,
  onSave,
}: {
  preview: ExternalAgentOverviewPreview
  onSave: (settings: ExternalConnectionSettings) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [authentication, setAuthentication] = useState(preview.authentication)
  const options = [
    { value: 'none', label: t(($) => $['external.connection.none']) },
    { value: 'bearer', label: t(($) => $['external.connection.bearerToken']) },
  ]
  return (
    <Form<{ endpoint: string; token?: string }>
      className="contents"
      onFormSubmit={({ endpoint, token }) =>
        onSave({
          endpoint: endpoint.trim(),
          authentication,
          token: authentication === 'bearer' ? token?.trim() || preview.token : '',
        })
      }
    >
      <DialogBody className="space-y-4">
        <Field
          name="endpoint"
          validate={(value) => {
            if (typeof value !== 'string' || !value.trim())
              return t(($) => $['external.connection.endpointRequired'])
            try {
              const url = new URL(value.trim())
              if (url.protocol === 'http:' || url.protocol === 'https:') return null
            } catch {}
            return t(($) => $['external.connection.endpointInvalid'])
          }}
        >
          <FieldLabel>{t(($) => $['external.connection.endpoint'])}</FieldLabel>
          <Input defaultValue={preview.endpoint} type="url" autoComplete="url" required />
          <FieldValidity>
            {({ validity, error }) => (
              <FieldError>
                {validity.valueMissing
                  ? t(($) => $['external.connection.endpointRequired'])
                  : validity.typeMismatch
                    ? t(($) => $['external.connection.endpointInvalid'])
                    : error}
              </FieldError>
            )}
          </FieldValidity>
        </Field>
        <Select<'none' | 'bearer'>
          items={options}
          value={authentication}
          onValueChange={(value) => value && setAuthentication(value)}
        >
          <div className="space-y-1">
            <SelectLabel>{t(($) => $['external.connection.authentication'])}</SelectLabel>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
          </div>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>{option.label}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {authentication === 'bearer' && (
          <Field
            name="token"
            validate={(value) =>
              preview.authentication === 'bearer' || (typeof value === 'string' && value.trim())
                ? null
                : t(($) => $['external.connection.tokenRequired'])
            }
          >
            <FieldLabel>{t(($) => $['external.connection.token'])}</FieldLabel>
            <Input
              type="password"
              autoComplete="off"
              placeholder={
                preview.authentication === 'bearer'
                  ? '••••••••'
                  : t(($) => $['external.connection.tokenPlaceholder'])
              }
              required={preview.authentication !== 'bearer'}
            />
            <FieldError>{t(($) => $['external.connection.tokenRequired'])}</FieldError>
          </Field>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}

export function EditExternalAgentConnection({
  preview,
  onUpdate,
}: {
  preview: ExternalAgentOverviewPreview
  onUpdate: (updates: Partial<ExternalAgentOverviewPreview>) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="small"
            className="h-auto px-0 py-0 system-xs-medium text-text-tertiary"
          />
        }
      >
        {t(($) => $['external.overview.editConnection'])}
      </DialogTrigger>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{t(($) => $['external.overview.editConnection'])}</DialogTitle>
          <DialogDescription>{t(($) => $['external.overview.mockNotice'])}</DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <ConnectionSettingsForm
          preview={preview}
          onSave={(settings) => {
            onUpdate(settings)
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
