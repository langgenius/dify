'use client'

import type {
  ExternalAgentAuthType,
  ExternalAgentCreatePayload,
  ExternalAgentDiscoveryResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { getAgentDetailPath } from '../../agent-detail/routes'
import { AgentKindBadge } from '../../components/agent-kind-badge'
import { ExternalAgentConnectionFields } from './external-agent-connection-fields'
import { getExternalAgentErrorMessage } from './external-agent-errors'

type ConnectExternalAgentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DialogStage = 'connection' | 'review'

function DiscoverySummary({ discovery }: { discovery: ExternalAgentDiscoveryResponse }) {
  const { t } = useTranslation('agentV2')
  const skills = discovery.agent_card.skills ?? []
  const capabilities = [
    discovery.agent_card.capabilities.streaming
      ? t(($) => $['externalAgent.capabilities.streaming'])
      : undefined,
    discovery.agent_card.capabilities.pushNotifications
      ? t(($) => $['externalAgent.capabilities.pushNotifications'])
      : undefined,
    discovery.agent_card.capabilities.extendedAgentCard
      ? t(($) => $['externalAgent.capabilities.extendedCard'])
      : undefined,
  ].filter((item): item is string => Boolean(item))

  return (
    <div className="rounded-xl border-[0.5px] border-components-panel-border bg-background-section p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-divider-subtle bg-components-panel-bg text-text-tertiary shadow-xs">
          <span aria-hidden className="i-ri-link-m size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate system-md-semibold text-text-primary">{discovery.name}</h3>
            <AgentKindBadge agentKind="external_agent" />
          </div>
          <p className="mt-0.5 line-clamp-2 system-xs-regular text-text-tertiary">
            {discovery.description}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-success">
          <span aria-hidden className="i-ri-checkbox-circle-fill size-3.5" />
          {t(($) => $['externalAgent.connectionVerified'])}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-divider-subtle pt-3">
        <div>
          <dt className="system-xs-medium text-text-tertiary">
            {t(($) => $['externalAgent.protocol'])}
          </dt>
          <dd className="mt-0.5 system-sm-medium text-text-secondary">
            A2A {discovery.protocol_version}
          </dd>
        </div>
        <div>
          <dt className="system-xs-medium text-text-tertiary">
            {t(($) => $['externalAgent.remoteVersion'])}
          </dt>
          <dd className="mt-0.5 system-sm-medium text-text-secondary">
            {discovery.agent_card.version}
          </dd>
        </div>
      </dl>

      {(capabilities.length > 0 || skills.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {capabilities.map((capability) => (
            <span
              key={capability}
              className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-xs-medium text-text-tertiary"
            >
              {capability}
            </span>
          ))}
          {skills.slice(0, 3).map((skill) => (
            <span
              key={skill.id}
              className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-xs-medium text-text-tertiary"
            >
              {skill.name}
            </span>
          ))}
          {skills.length > 3 && (
            <span className="px-1 py-0.5 system-xs-regular text-text-tertiary">
              {t(($) => $['externalAgent.moreSkills'], { count: skills.length - 3 })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function ConnectExternalAgentDialog({
  open,
  onOpenChange,
}: ConnectExternalAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<DialogStage>('connection')
  const [endpoint, setEndpoint] = useState('')
  const [authType, setAuthType] = useState<ExternalAgentAuthType>('none')
  const [bearerToken, setBearerToken] = useState('')
  const [discovery, setDiscovery] = useState<ExternalAgentDiscoveryResponse>()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [description, setDescription] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const discoverMutation = useMutation(consoleQuery.agent.external.discover.post.mutationOptions())
  const createMutation = useMutation(consoleQuery.agent.external.post.mutationOptions())
  const isPending = discoverMutation.isPending || createMutation.isPending
  const canCheck = Boolean(endpoint.trim()) && (authType === 'none' || Boolean(bearerToken.trim()))
  const canCreate = Boolean(name.trim()) && Boolean(discovery)
  const dialogDescription = useMemo(
    () =>
      stage === 'connection'
        ? t(($) => $['externalAgent.connectDescription'])
        : t(($) => $['externalAgent.reviewDescription']),
    [stage, t],
  )

  const reset = () => {
    setStage('connection')
    setEndpoint('')
    setAuthType('none')
    setBearerToken('')
    setDiscovery(undefined)
    setName('')
    setRole('')
    setDescription('')
    setErrorMessage('')
    discoverMutation.reset()
    createMutation.reset()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return

    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleConnectionChange = () => {
    setDiscovery(undefined)
    setErrorMessage('')
  }

  const handleCheckConnection = async () => {
    if (!canCheck || isPending) return

    setErrorMessage('')
    try {
      const result = await discoverMutation.mutateAsync({
        body: {
          endpoint: endpoint.trim(),
          auth_type: authType,
          ...(authType === 'bearer' ? { bearer_token: bearerToken } : {}),
        },
      })
      setDiscovery(result)
      setName(result.name)
      setDescription(result.description)
      setRole('')
      setStage('review')
    } catch (error) {
      setErrorMessage(
        (await getExternalAgentErrorMessage(error)) ??
          t(($) => $['externalAgent.errors.connectionFailed']),
      )
    }
  }

  const handleCreate = async () => {
    if (!canCreate || isPending) return

    setErrorMessage('')
    const body = {
      endpoint: endpoint.trim(),
      auth_type: authType,
      ...(authType === 'bearer' ? { bearer_token: bearerToken } : {}),
      name: name.trim(),
      description: description.trim(),
      role: role.trim(),
    } satisfies ExternalAgentCreatePayload

    try {
      const createdAgent = await createMutation.mutateAsync({ body })
      setBearerToken('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQuery.agent.get.key() }),
        queryClient.invalidateQueries({ queryKey: consoleQuery.agent.inviteOptions.get.key() }),
      ])
      toast.success(t(($) => $['externalAgent.connectSuccess']))
      handleOpenChange(false)
      router.push(getAgentDetailPath(createdAgent.id, 'configure'))
    } catch (error) {
      setErrorMessage(
        (await getExternalAgentErrorMessage(error)) ??
          t(($) => $['externalAgent.errors.createFailed']),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-140 flex-col overflow-hidden! p-0!">
        {!isPending && <DialogCloseButton />}
        <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
          <div className="flex items-center gap-2">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['externalAgent.connectTitle'])}
            </DialogTitle>
            <AgentKindBadge agentKind="external_agent" />
          </div>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {dialogDescription}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          {stage === 'connection' ? (
            <ExternalAgentConnectionFields
              authType={authType}
              bearerToken={bearerToken}
              disabled={isPending}
              endpoint={endpoint}
              onAuthTypeChange={(nextAuthType) => {
                handleConnectionChange()
                setAuthType(nextAuthType)
                if (nextAuthType === 'none') setBearerToken('')
              }}
              onBearerTokenChange={(value) => {
                handleConnectionChange()
                setBearerToken(value)
              }}
              onEndpointChange={(value) => {
                handleConnectionChange()
                setEndpoint(value)
              }}
            />
          ) : discovery ? (
            <div className="space-y-5">
              <DiscoverySummary discovery={discovery} />
              <div className="grid grid-cols-2 gap-3">
                <Field name="name">
                  <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
                  <FieldControl
                    autoComplete="off"
                    disabled={isPending}
                    maxLength={255}
                    onValueChange={setName}
                    required
                    value={name}
                  />
                </Field>
                <Field name="role">
                  <FieldLabel>{t(($) => $['roster.createForm.roleLabel'])}</FieldLabel>
                  <FieldControl
                    autoComplete="off"
                    disabled={isPending}
                    maxLength={255}
                    onValueChange={setRole}
                    placeholder={t(($) => $['roster.createForm.rolePlaceholder'])}
                    value={role}
                  />
                </Field>
              </div>
              <Field name="description">
                <FieldLabel>{t(($) => $['roster.createForm.descriptionLabel'])}</FieldLabel>
                <Textarea
                  className="h-20 resize-none"
                  disabled={isPending}
                  maxLength={400}
                  onValueChange={setDescription}
                  value={description}
                />
              </Field>
            </div>
          ) : null}

          {errorMessage && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2.5 system-xs-regular text-text-destructive"
            >
              <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0" />
              <span className="min-w-0 flex-1 wrap-break-word">{errorMessage}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
          {stage === 'connection' ? (
            <>
              <Button
                type="button"
                className="min-w-18"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="min-w-28"
                disabled={!canCheck || isPending}
                loading={discoverMutation.isPending}
                onClick={() => void handleCheckConnection()}
              >
                {t(($) => $['externalAgent.checkConnection'])}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                className="min-w-18"
                disabled={isPending}
                onClick={() => {
                  setErrorMessage('')
                  setStage('connection')
                }}
              >
                {t(($) => $['externalAgent.back'])}
              </Button>
              <Button
                type="button"
                variant="primary"
                className="min-w-28"
                disabled={!canCreate || isPending}
                loading={createMutation.isPending}
                onClick={() => void handleCreate()}
              >
                {t(($) => $['externalAgent.connectAction'])}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
