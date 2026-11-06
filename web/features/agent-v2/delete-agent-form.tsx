'use client'

import {
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

export function DeleteAgentForm({
  agentName,
  isPending,
  error,
  onSubmit,
}: {
  agentName: string
  isPending: boolean
  error?: string
  onSubmit: () => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  // Keep the name the user is asked to type stable while a list refresh lands mid-dialog.
  const [name] = useState(agentName)
  const [confirmation, setConfirmation] = useState('')

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!isPending && confirmation === name) onSubmit()
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t(($) => $['roster.deleteDialog.title'], { ns: 'agentRoster', name })}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $['roster.deleteDialog.description'], { ns: 'agentRoster', name })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogBody>
        <Field name="confirm-agent-name">
          <FieldLabel>
            <Trans
              i18nKey={($) => $['roster.deleteDialog.inputLabel']}
              ns="agentRoster"
              values={{ name }}
              components={{
                name: <span className="system-sm-semibold text-text-primary" translate="no" />,
              }}
            />
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onValueChange={setConfirmation}
              readOnly={isPending}
              placeholder={t(($) => $['roster.deleteDialog.inputPlaceholder'], {
                ns: 'agentRoster',
              })}
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                variant="tertiary"
                size="small"
                disabled={isPending}
                onClick={() => setConfirmation(name)}
              >
                {t(($) => $['operation.fill'], { ns: 'common' })}
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        {error && (
          <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
            {error}
          </p>
        )}
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCancelButton type="button" disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          type="submit"
          loading={isPending}
          disabled={confirmation !== name}
        >
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </form>
  )
}
