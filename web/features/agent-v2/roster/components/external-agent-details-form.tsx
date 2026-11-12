import type {
  ExternalAgentAssetResponse,
  ExternalAgentVerificationResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogFooter } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { asRecord, stringValue } from '@/features/agent-v2/external-agent/model'
import { ExternalConnectionSteps } from './external-connection-steps'

export type ExternalAgentConnectionDetails = Pick<
  ExternalAgentAssetResponse,
  'name' | 'role' | 'description'
>

type ExternalAgentDetailsFormProps = {
  verification: ExternalAgentVerificationResponse
  initialDetails: ExternalAgentConnectionDetails
  onBack: (details: ExternalAgentConnectionDetails) => void
  onSave: (details: ExternalAgentConnectionDetails) => void
  pending: boolean
  locked: boolean
  canSave: boolean
  error?: string
}

function focusRole(input: HTMLInputElement | null) {
  input?.focus()
}

export function ExternalAgentDetailsForm({
  verification,
  initialDetails,
  onBack,
  onSave,
  pending,
  locked,
  canSave,
  error,
}: ExternalAgentDetailsFormProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [name, setName] = useState(initialDetails.name)
  const [role, setRole] = useState(initialDetails.role)
  const [description, setDescription] = useState(initialDetails.description)
  const descriptionLabelId = useId()
  const card = verification.card
  const cardName = stringValue(card.name)
  const skills = Array.isArray(card.skills) ? card.skills : []
  const interfaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : []
  const protocol = interfaces
    .map((value) => stringValue(asRecord(value).protocolVersion))
    .find(Boolean)
  const iconUrl = stringValue(card.iconUrl)

  return (
    <Form<ExternalAgentConnectionDetails>
      className="contents"
      onFormSubmit={() => {
        if (!pending && canSave) onSave({ name: name.trim(), role: role.trim(), description })
      }}
    >
      <DialogBody className="space-y-4">
        <ExternalConnectionSteps step="details" />
        <section
          className="space-y-3 rounded-[10px] bg-background-section px-4 py-3.5"
          aria-label={cardName}
        >
          <div className="flex flex-wrap items-center gap-3">
            <AppIcon
              icon={iconUrl ? { icon_type: 'link', icon: iconUrl } : undefined}
              size="medium"
              fallback={{
                content: <span className="i-ri-robot-2-line size-5 text-text-tertiary" />,
                background: 'var(--color-components-icon-bg-midnight-soft)',
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="system-sm-semibold wrap-break-word text-text-primary">{cardName}</p>
              {protocol && <p className="system-xs-regular text-text-tertiary">A2A {protocol}</p>}
            </div>
            <Badge className="h-auto rounded-md border-text-success system-xs-medium leading-4 text-text-success normal-case">
              {t(($) => $['external.connection.verified'])}
            </Badge>
          </div>
          <p className="system-xs-regular text-text-secondary">
            {verification.auth_check === 'passed_for_read_endpoint'
              ? t(($) => $['external.connection.authReadPassed'])
              : t(($) => $['external.connection.authNotExercised'])}
          </p>
          <div className="h-px bg-divider-subtle" />
          <div className="space-y-1.5">
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['external.connection.skills'])}
            </p>
            {skills.length ? (
              <ul className="flex flex-wrap gap-1">
                {skills.map((value, index) => {
                  const skill = asRecord(value)
                  return (
                    <li key={stringValue(skill.id) || index}>
                      <Badge className="h-auto gap-0.75 rounded-md border-divider-regular bg-components-badge-white-to-dark system-xs-medium leading-4 text-text-tertiary normal-case">
                        <span aria-hidden className="i-ri-box-3-line size-3 shrink-0" />
                        <span className="wrap-break-word">{stringValue(skill.name)}</span>
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['external.overview.emptySkills'])}
              </p>
            )}
          </div>
        </section>
        <Field name="name" disabled={locked}>
          <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
          <Input value={name} onValueChange={setName} maxLength={255} required />
        </Field>
        <Field name="role" disabled={locked}>
          <FieldLabel>
            {t(($) => $['roster.createForm.roleLabel'])}
            <span className="ms-0.5 font-normal text-text-tertiary">
              {t(($) => $['label.optional'], { ns: 'common' })}
            </span>
          </FieldLabel>
          <Input
            ref={focusRole}
            autoComplete="off"
            maxLength={255}
            value={role}
            onValueChange={setRole}
            placeholder={t(($) => $['external.connection.rolePlaceholder'])}
          />
        </Field>
        <Field name="description" disabled={locked}>
          <div className="flex items-center gap-0.5">
            <FieldLabel id={descriptionLabelId}>
              {t(($) => $['roster.createForm.descriptionLabel'])}
            </FieldLabel>
            <Infotip>
              <InfotipTrigger aria-labelledby={descriptionLabelId} />
              <InfotipContent aria-labelledby={descriptionLabelId} className="max-w-64">
                {t(($) => $['external.connection.descriptionHint'])}
              </InfotipContent>
            </Infotip>
          </div>
          <Textarea
            className="h-22"
            maxLength={10000}
            value={description}
            onValueChange={setDescription}
          />
        </Field>
        {error && (
          <Alert type="error">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          disabled={locked}
          className="min-w-18"
          onClick={() => onBack({ name, role, description })}
        >
          {t(($) => $['operation.back'], { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={!canSave}
          className="min-w-18"
        >
          {locked && !pending
            ? t(($) => $['external.api.retrySave'])
            : t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}
