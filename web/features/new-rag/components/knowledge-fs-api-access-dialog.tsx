'use client'

import type {
  KnowledgeFsCredentialCreateResponse,
  KnowledgeFsCredentialItemResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { consoleClient, consoleQuery } from '@/service/client'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'

const DEFAULT_ALLOWED_ACTIONS = ['queries.create']

function maskedCredential(credential: KnowledgeFsCredentialItemResponse) {
  return `${credential.credential_prefix}••••${credential.credential_last4}`
}

export function KnowledgeFsApiAccessDialog({
  canManageCredentials,
  enabled,
  knowledgeSpaceId,
  onOpenChange,
  open,
}: {
  canManageCredentials: boolean
  enabled: boolean
  knowledgeSpaceId: string
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tAppApi, i18n } = useTranslation('appApi')
  const { t: tCommon } = useTranslation('common')
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const [createdCredential, setCreatedCredential] = useState<KnowledgeFsCredentialCreateResponse>()
  const [credentialToRevoke, setCredentialToRevoke] = useState<KnowledgeFsCredentialItemResponse>()
  const [actionError, setActionError] = useState<'create' | 'revoke'>()
  const credentialsQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.credentials.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      context: { silent: true },
    }),
    enabled: open && enabled && canManageCredentials,
  })
  const createMutation = useMutation({
    mutationFn: (
      input: Parameters<
        typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.credentials.post
      >[0],
    ) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.credentials.post(input, {
        context: { silent: true },
      }),
  })
  const revokeMutation = useMutation({
    mutationFn: (
      input: Parameters<
        typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.credentials.byCredentialId.delete
      >[0],
    ) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.credentials.byCredentialId.delete(input, {
        context: { silent: true },
      }),
  })
  const endpoint = apiBaseInfo?.api_base_url
    ? `${apiBaseInfo.api_base_url.replace(/\/$/, '')}/knowledge-fs/spaces/${encodeURIComponent(knowledgeSpaceId)}/queries/admission`
    : ''

  const createCredential = async () => {
    if (!enabled || !canManageCredentials || createMutation.isPending) return
    setActionError(undefined)
    try {
      const result = await createMutation.mutateAsync({
        body: { allowed_actions: DEFAULT_ALLOWED_ACTIONS, expires_at: null },
        params: { control_space_id: knowledgeSpaceId },
      })
      setCreatedCredential(result)
      await credentialsQuery.refetch()
    } catch {
      setActionError('create')
    }
  }

  const revokeCredential = async () => {
    if (!credentialToRevoke || revokeMutation.isPending) return
    setActionError(undefined)
    try {
      await revokeMutation.mutateAsync({
        params: {
          control_space_id: knowledgeSpaceId,
          credential_id: credentialToRevoke.id,
        },
      })
      setCredentialToRevoke(undefined)
      await credentialsQuery.refetch()
    } catch {
      setActionError('revoke')
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCreatedCredential(undefined)
      setCredentialToRevoke(undefined)
      setActionError(undefined)
    }
    onOpenChange(nextOpen)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-150! max-w-[calc(100vw-2rem)]! flex-col overflow-hidden! rounded-2xl! p-0!">
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div>
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['newKnowledge.apiAgentAccess'])}
              </DialogTitle>
              <p className="mt-1 body-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.apiCredentialDescription'])}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-label={tCommon(($) => $['operation.close'])}
              className="size-8 shrink-0 px-0"
              onClick={() => handleOpenChange(false)}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
            <section>
              <p className="system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $['serviceApi.card.endpoint'])}
              </p>
              <div className="mt-1 flex min-h-8 items-center gap-1 rounded-lg bg-components-input-bg-normal py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary">
                  {endpoint || tAppApi(($) => $.loading)}
                </code>
                {endpoint && <CopyFeedback content={endpoint} />}
              </div>
            </section>

            {!enabled ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.apiAccessInactive'])}
              </div>
            ) : !canManageCredentials ? (
              <div className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.settings.viewOnly'])}
              </div>
            ) : (
              <>
                {createdCredential && (
                  <section
                    className="rounded-xl border border-text-success/20 bg-state-success-hover p-3"
                    role="status"
                  >
                    <p className="system-sm-semibold text-text-secondary">
                      {tAppApi(($) => $['apiKeyModal.secretKey'])}
                    </p>
                    <p className="mt-1 body-xs-regular text-text-tertiary">
                      {tAppApi(($) => $['apiKeyModal.generateTips'])}
                    </p>
                    <div className="mt-2 flex min-h-8 items-center gap-1 rounded-lg bg-components-input-bg-normal py-1 pr-1 pl-3">
                      <code className="min-w-0 flex-1 system-xs-medium break-all text-text-secondary">
                        {createdCredential.credential}
                      </code>
                      <CopyFeedback content={createdCredential.credential} />
                    </div>
                  </section>
                )}

                {actionError === 'create' && (
                  <div
                    className="rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 body-xs-regular text-text-destructive"
                    role="alert"
                  >
                    {tCommon(($) => $['api.actionFailed'])}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <p className="system-sm-semibold text-text-secondary">
                    {tAppApi(($) => $['apiKeyModal.apiSecretKey'])}
                  </p>
                  <Button
                    type="button"
                    size="small"
                    variant="primary"
                    loading={createMutation.isPending}
                    onClick={() => void createCredential()}
                  >
                    {tAppApi(($) => $['apiKeyModal.createNewSecretKey'])}
                  </Button>
                </div>

                {credentialsQuery.isPending ? (
                  <p role="status" className="py-5 text-center body-xs-regular text-text-tertiary">
                    {tAppApi(($) => $.loading)}
                  </p>
                ) : credentialsQuery.isError ? (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2"
                    role="alert"
                  >
                    <span className="body-xs-regular text-text-destructive">
                      {tCommon(($) => $['api.actionFailed'])}
                    </span>
                    <Button size="small" onClick={() => void credentialsQuery.refetch()}>
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                ) : credentialsQuery.data?.data.length ? (
                  <ul className="space-y-2">
                    {credentialsQuery.data.data.map((credential) => {
                      const masked = maskedCredential(credential)
                      return (
                        <li
                          key={credential.id}
                          className="flex min-w-0 items-center gap-3 rounded-xl border border-components-panel-border px-3 py-2"
                        >
                          <span
                            aria-hidden
                            className={`size-2 shrink-0 rounded-full ${credential.status === 'active' ? 'bg-util-colors-green-green-500' : 'bg-text-quaternary'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <code className="system-xs-medium text-text-secondary">{masked}</code>
                            <p className="mt-0.5 body-xs-regular text-text-tertiary">
                              {tAppApi(($) => $['apiKeyModal.lastUsed'])}:{' '}
                              {credential.last_used_at
                                ? new Date(credential.last_used_at).toLocaleString(i18n.language)
                                : tAppApi(($) => $.never)}
                            </p>
                          </div>
                          <span className="sr-only">
                            {t(($) =>
                              credential.status === 'active'
                                ? $['newKnowledge.apiAccessActive']
                                : $['newKnowledge.apiAccessInactive'],
                            )}
                          </span>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            aria-label={`${tCommon(($) => $['operation.delete'])} ${masked}`}
                            disabled={credential.status !== 'active'}
                            onClick={() => {
                              setActionError(undefined)
                              setCredentialToRevoke(credential)
                            }}
                          >
                            <span aria-hidden className="i-ri-delete-bin-line size-4" />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="py-5 text-center body-xs-regular text-text-tertiary">
                    {tAppApi(($) => $['develop.noContent'])}
                  </p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(credentialToRevoke)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !revokeMutation.isPending) {
            setCredentialToRevoke(undefined)
            setActionError(undefined)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{tAppApi(($) => $['actionMsg.deleteConfirmTitle'])}</AlertDialogTitle>
          <AlertDialogDescription>
            {tAppApi(($) => $['actionMsg.deleteConfirmTips'])}
          </AlertDialogDescription>
          {actionError === 'revoke' && (
            <div
              className="mx-6 mt-4 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 body-xs-regular text-text-destructive"
              role="alert"
            >
              {tCommon(($) => $['api.actionFailed'])}
            </div>
          )}
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={revokeMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={revokeMutation.isPending}
              onClick={() => void revokeCredential()}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
