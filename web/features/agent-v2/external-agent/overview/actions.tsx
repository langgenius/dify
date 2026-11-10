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
import { Menu, MenuContent, MenuLinkItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import Link from '@/next/link'
import { ExternalAgentManageMenu } from '../manage-menu'

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
          <MenuTrigger render={<Button variant="primary" disabled={!agent.enabled} />}>
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['external.overview.createApp'])}
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </MenuTrigger>
          <MenuContent align="end" className="min-w-64">
            <MenuLinkItem render={<Link href="/apps?create=blank&mode=workflow" />}>
              <span
                aria-hidden
                className="i-ri-exchange-2-line size-4 shrink-0 text-text-primary"
              />
              <span className="px-1">{t(($) => $['types.workflow'], { ns: 'app' })}</span>
            </MenuLinkItem>
            <MenuLinkItem render={<Link href="/apps?create=blank&mode=advanced-chat" />}>
              <span aria-hidden className="i-ri-message-3-line size-4 shrink-0 text-text-primary" />
              <span className="px-1">{t(($) => $['types.advanced'], { ns: 'app' })}</span>
            </MenuLinkItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}
