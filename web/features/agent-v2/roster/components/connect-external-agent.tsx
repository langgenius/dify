'use client'

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
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
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

function ConnectionForm() {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [authentication, setAuthentication] = useState<'none' | 'bearer'>('none')
  const options = [
    { value: 'none', label: t(($) => $['external.connection.none']) },
    { value: 'bearer', label: t(($) => $['external.connection.bearerToken']) },
  ]

  return (
    <form className="contents" onSubmit={(event) => event.preventDefault()}>
      <DialogBody className="flex flex-col gap-4">
        <ol className="flex items-center gap-2 system-xs-regular">
          <li aria-current="step" className="flex items-center gap-1.5 text-text-primary">
            <span className="flex size-4 items-center justify-center rounded-full border border-state-accent-hover-alt bg-util-colors-blue-brand-blue-brand-100 system-2xs-medium text-text-accent">
              1
            </span>
            {t(($) => $['external.connection.step'])}
          </li>
          <li aria-hidden className="h-px w-5 bg-divider-subtle" />
          <li className="flex items-center gap-1.5 text-text-tertiary">
            <span className="flex size-4 items-center justify-center rounded-full border border-divider-regular system-2xs-medium text-text-quaternary">
              2
            </span>
            {t(($) => $['external.connection.details'])}
          </li>
        </ol>
        <Field name="endpoint" className="flex flex-col gap-1.5">
          <FieldLabel>{t(($) => $['external.connection.endpoint'])}</FieldLabel>
          <Input placeholder="https://" type="url" autoComplete="url" />
        </Field>
        <div className="h-px bg-divider-subtle" />
        <Select<'none' | 'bearer'>
          items={options}
          value={authentication}
          onValueChange={(value) => {
            if (value) setAuthentication(value)
          }}
        >
          <div className="flex flex-col gap-1">
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
          <Field name="token" className="flex flex-col gap-1.5">
            <FieldLabel>{t(($) => $['external.connection.token'])}</FieldLabel>
            <Input
              type="password"
              autoComplete="off"
              placeholder={t(($) => $['external.connection.tokenPlaceholder'])}
            />
          </Field>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        {/* Verification remains unavailable until the connection contract is implemented. */}
        <Button type="submit" variant="primary" disabled>
          {t(($) => $['external.connection.verify'])}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ConnectExternalAgent() {
  const { t } = useTranslation(['agentRoster', 'common'])
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="primary" />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['external.connect'])}
      </DialogTrigger>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{t(($) => $['external.connect'])}</DialogTitle>
          <DialogDescription>{t(($) => $['external.connection.description'])}</DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <ConnectionForm />
      </DialogContent>
    </Dialog>
  )
}
