'use client'

import type {
  ExternalAgentAuthType,
  ExternalAgentDetailResponse,
  ExternalAgentUpdatePayload,
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { ExternalAgentConnectionFields } from '../../roster/components/external-agent-connection-fields'
import { getExternalAgentErrorMessage } from '../../roster/components/external-agent-errors'

type EditExternalAgentDialogProps = {
  agent: ExternalAgentDetailResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

const endpointsHaveSameOrigin = (firstEndpoint: string, secondEndpoint: string) => {
  try {
    return new URL(firstEndpoint).origin === new URL(secondEndpoint).origin
  } catch {
    return false
  }
}

export function EditExternalAgentDialog({
  agent,
  open,
  onOpenChange,
}: EditExternalAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [endpoint, setEndpoint] = useState(agent.endpoint)
  const [authType, setAuthType] = useState<ExternalAgentAuthType>(agent.auth_type)
  const [bearerToken, setBearerToken] = useState('')
  const [name, setName] = useState(agent.name)
  const [role, setRole] = useState(agent.role ?? '')
  const [description, setDescription] = useState(agent.description)
  const [errorMessage, setErrorMessage] = useState('')
  const updateMutation = useMutation(consoleQuery.agent.byAgentId.external.put.mutationOptions())
  const canReuseStoredToken =
    agent.has_bearer_token && endpointsHaveSameOrigin(agent.endpoint, endpoint)
  const hasUsableToken = authType === 'none' || Boolean(bearerToken.trim()) || canReuseStoredToken
  const canSave = Boolean(endpoint.trim()) && Boolean(name.trim()) && hasUsableToken

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && updateMutation.isPending) return

    onOpenChange(nextOpen)
    if (!nextOpen) setBearerToken('')
  }

  const handleSave = async () => {
    if (!canSave || updateMutation.isPending) return

    setErrorMessage('')
    const body = {
      endpoint: endpoint.trim(),
      auth_type: authType,
      ...(authType === 'bearer' && bearerToken ? { bearer_token: bearerToken } : {}),
      expected_active_config_snapshot_id: agent.active_config_snapshot_id,
      name: name.trim(),
      description: description.trim(),
      role: role.trim(),
    } satisfies ExternalAgentUpdatePayload

    try {
      await updateMutation.mutateAsync({
        params: { agent_id: agent.id },
        body,
      })
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.get.key({
            input: { params: { agent_id: agent.id } },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.agent.byAgentId.external.get.key({
            input: { params: { agent_id: agent.id } },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: consoleQuery.agent.get.key() }),
        queryClient.invalidateQueries({ queryKey: consoleQuery.agent.inviteOptions.get.key() }),
      ])
      setBearerToken('')
      toast.success(t(($) => $['externalAgent.updateSuccess']))
      handleOpenChange(false)
    } catch (error) {
      setErrorMessage(
        (await getExternalAgentErrorMessage(error)) ??
          t(($) => $['externalAgent.errors.updateFailed']),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-140 flex-col overflow-hidden! p-0!">
        {!updateMutation.isPending && <DialogCloseButton />}
        <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['externalAgent.edit.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['externalAgent.edit.description'])}
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-3">
          <ExternalAgentConnectionFields
            authType={authType}
            bearerToken={bearerToken}
            bearerTokenHelp={
              canReuseStoredToken && authType === 'bearer'
                ? t(($) => $['externalAgent.auth.savedTokenHelp'])
                : undefined
            }
            bearerTokenPlaceholder={
              canReuseStoredToken && authType === 'bearer'
                ? t(($) => $['externalAgent.auth.savedTokenPlaceholder'])
                : undefined
            }
            bearerTokenRequired={authType === 'bearer' && !canReuseStoredToken}
            disabled={updateMutation.isPending}
            endpoint={endpoint}
            onAuthTypeChange={(nextAuthType) => {
              setAuthType(nextAuthType)
              if (nextAuthType === 'none') setBearerToken('')
            }}
            onBearerTokenChange={setBearerToken}
            onEndpointChange={setEndpoint}
          />

          <div className="border-t border-divider-subtle pt-5">
            <div className="grid grid-cols-2 gap-3">
              <Field name="name">
                <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
                <FieldControl
                  disabled={updateMutation.isPending}
                  maxLength={255}
                  onValueChange={setName}
                  required
                  value={name}
                />
              </Field>
              <Field name="role">
                <FieldLabel>{t(($) => $['roster.createForm.roleLabel'])}</FieldLabel>
                <FieldControl
                  disabled={updateMutation.isPending}
                  maxLength={255}
                  onValueChange={setRole}
                  value={role}
                />
              </Field>
            </div>
            <Field name="description" className="mt-5">
              <FieldLabel>{t(($) => $['roster.createForm.descriptionLabel'])}</FieldLabel>
              <Textarea
                className="h-20 resize-none"
                disabled={updateMutation.isPending}
                maxLength={400}
                onValueChange={setDescription}
                value={description}
              />
            </Field>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2.5 system-xs-regular text-text-destructive"
            >
              <span aria-hidden className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0" />
              <span className="min-w-0 flex-1 wrap-break-word">{errorMessage}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
          <Button
            type="button"
            className="min-w-18"
            disabled={updateMutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="min-w-28"
            disabled={!canSave || updateMutation.isPending}
            loading={updateMutation.isPending}
            onClick={() => void handleSave()}
          >
            {t(($) => $['externalAgent.edit.saveAndVerify'])}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
