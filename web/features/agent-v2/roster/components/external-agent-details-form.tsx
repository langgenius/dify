import type { ExternalConnectionPreview } from '../external-roster-preview'
import type { ExternalAgentListItem } from './external-agent-list'
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
import { ExternalConnectionSteps } from './external-connection-steps'

export type ExternalAgentConnectionDetails = Pick<
  ExternalAgentListItem,
  'name' | 'role' | 'description'
>

type ExternalAgentDetailsFormProps = {
  agent: ExternalConnectionPreview
  initialDetails: ExternalAgentConnectionDetails
  onBack: (details: ExternalAgentConnectionDetails) => void
  onSave: (details: ExternalAgentConnectionDetails) => void
}

function focusRole(input: HTMLInputElement | null) {
  input?.focus()
}

export function ExternalAgentDetailsForm({
  agent,
  initialDetails,
  onBack,
  onSave,
}: ExternalAgentDetailsFormProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [role, setRole] = useState(initialDetails.role)
  const [description, setDescription] = useState(initialDetails.description)
  const descriptionLabelId = useId()

  return (
    <Form<Pick<ExternalAgentConnectionDetails, 'role' | 'description'>>
      className="contents"
      onFormSubmit={(values) =>
        onSave({
          name: agent.name,
          role: values.role.trim(),
          description: values.description.trim(),
        })
      }
    >
      <DialogBody className="space-y-4">
        <ExternalConnectionSteps step="details" />
        <section
          className="space-y-3 rounded-[10px] bg-background-section px-4 py-3.5"
          aria-label={agent.name}
        >
          <div className="flex flex-wrap items-center gap-3">
            <AppIcon
              icon={agent.icon}
              size="medium"
              fallback={{
                content: <span className="i-ri-robot-2-line size-5 text-text-tertiary" />,
                background: 'var(--color-components-icon-bg-midnight-soft)',
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="system-sm-semibold wrap-break-word text-text-primary">{agent.name}</p>
              <p className="system-xs-regular text-text-tertiary">{agent.protocol}</p>
            </div>
            <Badge className="h-auto rounded-md border-text-success system-xs-medium leading-4 text-text-success normal-case">
              {t(($) => $['external.connection.verified'])}
            </Badge>
          </div>
          <div className="h-px bg-divider-subtle" />
          <div className="space-y-1.5">
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['external.connection.skills'])}
            </p>
            <ul className="flex flex-wrap gap-1">
              {agent.skills.map((skill) => (
                <li key={skill}>
                  <Badge className="h-auto gap-0.75 rounded-md border-divider-regular bg-components-badge-white-to-dark system-xs-medium leading-4 text-text-tertiary normal-case">
                    <span aria-hidden className="i-ri-box-3-line size-3 shrink-0" />
                    <span className="wrap-break-word">{skill}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <Field name="role">
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
            placeholder={t(($) => $['external.connection.rolePlaceholder'])}
            value={role}
            onValueChange={setRole}
          />
        </Field>
        <Field name="description">
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
            maxLength={400}
            value={description}
            onValueChange={setDescription}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          className="min-w-18"
          onClick={() => onBack({ name: agent.name, role, description })}
        >
          {t(($) => $['operation.back'], { ns: 'common' })}
        </Button>
        <Button type="submit" variant="primary" className="min-w-18">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}
