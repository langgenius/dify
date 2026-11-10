'use client'

import type { ExternalAgentListItem } from '../../roster/components/external-agent-list'
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
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { ExternalAgentManageMenu } from '../manage-menu'

type AppKind = ExternalAgentListItem['apps'][number]['kind']

function TestAgentForm({ sampleResponse }: { sampleResponse: string }) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [hasResponse, setHasResponse] = useState(false)

  return (
    <Form<{ request: string }> className="contents" onFormSubmit={() => setHasResponse(true)}>
      <DialogBody className="space-y-4">
        <Field
          name="request"
          validate={(value) =>
            typeof value === 'string' && value.trim()
              ? null
              : t(($) => $['external.overview.requestRequired'])
          }
        >
          <FieldLabel>{t(($) => $['external.overview.testRequest'])}</FieldLabel>
          <Textarea
            className="min-h-28"
            placeholder={t(($) => $['external.overview.testRequestPlaceholder'])}
            required
          />
          <FieldError>{t(($) => $['external.overview.requestRequired'])}</FieldError>
        </Field>
        {hasResponse && (
          <div
            role="status"
            className="space-y-2 rounded-xl border border-divider-subtle bg-background-section p-4"
          >
            <h3 className="system-sm-semibold text-text-secondary">
              {t(($) => $['external.overview.sampleResponse'])}
            </h3>
            <p className="system-sm-regular text-text-tertiary">{sampleResponse}</p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.close'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary">
          {t(($) => $['external.overview.sendRequest'])}
        </Button>
      </DialogFooter>
    </Form>
  )
}

function CreateAppForm({ onCreate }: { onCreate: (name: string) => void }) {
  const { t } = useTranslation(['agentRoster', 'common', 'app'])

  return (
    <Form<{ name: string }> className="contents" onFormSubmit={({ name }) => onCreate(name.trim())}>
      <DialogBody>
        <Field
          name="name"
          validate={(value) =>
            typeof value === 'string' && value.trim()
              ? null
              : t(($) => $['external.overview.appNameRequired'])
          }
        >
          <FieldLabel>{t(($) => $['external.overview.appName'])}</FieldLabel>
          <Input
            autoComplete="off"
            maxLength={255}
            placeholder={t(($) => $.appNamePlaceholder, { ns: 'app' })}
            required
          />
          <FieldError>{t(($) => $['external.overview.appNameRequired'])}</FieldError>
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary">
          {t(($) => $['external.overview.createApp'])}
        </Button>
      </DialogFooter>
    </Form>
  )
}

export function ExternalAgentOverviewActions({
  agent,
  onUpdate,
  sampleResponse,
}: {
  agent: ExternalAgentListItem
  onUpdate: (agent: ExternalAgentListItem) => void
  sampleResponse: string
}) {
  const { t } = useTranslation(['agentRoster', 'common', 'app'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const [appKind, setAppKind] = useState<AppKind>('workflow')
  const [createOpen, setCreateOpen] = useState(false)
  const selectAppKind = (kind: AppKind) => {
    setAppKind(kind)
    setCreateOpen(true)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ExternalAgentManageMenu agent={agent} onUpdate={onUpdate} />
      <Dialog>
        <DialogTrigger render={<Button variant="secondary" />}>
          <span aria-hidden className="i-ri-play-circle-line size-4" />
          {t(($) => $['external.overview.test'])}
        </DialogTrigger>
        <DialogContent className="w-150">
          <DialogHeader>
            <DialogTitle>{t(($) => $['external.overview.test'])}</DialogTitle>
            <DialogDescription>{t(($) => $['external.overview.mockNotice'])}</DialogDescription>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <TestAgentForm sampleResponse={sampleResponse} />
        </DialogContent>
      </Dialog>
      {canManage && (
        <Menu>
          <MenuTrigger
            render={<Button ref={createTriggerRef} variant="primary" disabled={!agent.enabled} />}
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['external.overview.createApp'])}
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem onClick={() => selectAppKind('workflow')}>
              <span aria-hidden>⚙️</span>
              {t(($) => $['types.workflow'], { ns: 'app' })}
            </MenuItem>
            <MenuItem onClick={() => selectAppKind('chatflow')}>
              <span aria-hidden>💬</span>
              {t(($) => $['types.advanced'], { ns: 'app' })}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-120" finalFocus={createTriggerRef}>
          <DialogHeader>
            <DialogTitle>{t(($) => $['external.overview.createApp'])}</DialogTitle>
            <DialogDescription>
              {t(($) => $['external.overview.mockNotice'])}
              {' · '}
              {appKind === 'workflow'
                ? t(($) => $['types.workflow'], { ns: 'app' })
                : t(($) => $['types.advanced'], { ns: 'app' })}
            </DialogDescription>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <CreateAppForm
            onCreate={(name) => {
              onUpdate({
                ...agent,
                apps: [...agent.apps, { id: crypto.randomUUID(), name, kind: appKind }],
                updatedAt: Date.now(),
              })
              setCreateOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
