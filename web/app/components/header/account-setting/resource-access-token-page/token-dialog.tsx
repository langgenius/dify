'use client'

import type { FormEvent } from 'react'
import type { DialogState, ResourceCandidate } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import copy from 'copy-to-clipboard'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { candidateKey } from './resource-key'
import ResourceSelector from './resource-selector'
import { useInvalidateResourceAccessTokens } from './use-invalidate-resource-access-tokens'

export default function ResourceAccessTokenDialog({
  open,
  state,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  state: DialogState
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const isEdit = state.mode === 'edit'
  const [name, setName] = useState(isEdit ? state.row.name : '')
  const initialResources = useMemo<ResourceCandidate[]>(
    () =>
      isEdit
        ? state.row.relations.map((relation) => ({
            id: relation.resource_id,
            name: relation.resource_name,
            type: relation.resource_type,
          }))
        : [],
    [isEdit, state],
  )
  const [selectedResources, setSelectedResources] = useState<Map<string, ResourceCandidate>>(
    () => new Map(initialResources.map((resource) => [candidateKey(resource), resource])),
  )
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const invalidateResourceAccessTokens = useInvalidateResourceAccessTokens()
  const createMutation = useMutation(consoleQuery.resourceAccessTokens.post.mutationOptions())
  const updateMutation = useMutation(
    consoleQuery.resourceAccessTokens.byTokenId.patch.mutationOptions(),
  )
  const isSaving = createMutation.isPending || updateMutation.isPending
  const nameLabel = t(($) => $['resourceAccessToken.name'], { ns: 'accountSettings' })

  const toggleResource = (candidate: ResourceCandidate) => {
    const key = candidateKey(candidate)
    setSelectedResources((current) => {
      const next = new Map(current)
      if (next.has(key)) next.delete(key)
      else next.set(key, candidate)
      return next
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) return

    const resources = Array.from(selectedResources.values(), ({ id, type }) => ({ id, type }))
    if (!resources.length) return

    if (isEdit) {
      updateMutation.mutate(
        {
          body: {
            name: normalizedName,
            resources,
          },
          params: {
            token_id: state.row.tokenId,
          },
        },
        {
          onSuccess: () => {
            toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
            void invalidateResourceAccessTokens()
            onSaved()
          },
        },
      )
      return
    }

    createMutation.mutate(
      {
        body: {
          name: normalizedName,
          resources,
        },
      },
      {
        onSuccess: (result) => {
          toast.success(t(($) => $['resourceAccessToken.created'], { ns: 'accountSettings' }))
          void invalidateResourceAccessTokens()
          setCreatedToken(result.token)
        },
      },
    )
  }

  const copyCreatedToken = () => {
    if (!createdToken) return

    copy(createdToken)
    toast.success(t(($) => $['resourceAccessToken.copied'], { ns: 'accountSettings' }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-160 border-none p-8 pb-6 text-left"
      >
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <DialogTitle className="mb-5 pr-8 text-xl font-semibold text-text-primary">
          {isEdit
            ? t(($) => $['resourceAccessToken.editTitle'], { ns: 'accountSettings' })
            : createdToken
              ? t(($) => $['resourceAccessToken.createdToken'], { ns: 'accountSettings' })
              : t(($) => $['resourceAccessToken.createTitle'], { ns: 'accountSettings' })}
        </DialogTitle>

        {createdToken ? (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <div className="system-sm-regular text-text-tertiary">
                {t(($) => $['resourceAccessToken.createdTokenDescription'], {
                  ns: 'accountSettings',
                })}
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-components-panel-border bg-components-input-bg-normal p-2">
                <code className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-text-primary">
                  {createdToken}
                </code>
                <IconButton
                  size="md"
                  aria-label={t(($) => $['operation.copy'], { ns: 'common' })}
                  onClick={copyCreatedToken}
                >
                  <span aria-hidden className="i-ri-file-copy-line size-4" />
                </IconButton>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>
                {t(($) => $['resourceAccessToken.done'], { ns: 'accountSettings' })}
              </Button>
            </div>
          </div>
        ) : (
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <Field name="name">
              <FieldLabel>{nameLabel}</FieldLabel>
              <Input
                required
                value={name}
                placeholder={t(($) => $['resourceAccessToken.namePlaceholder'], {
                  ns: 'accountSettings',
                })}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError match="valueMissing">
                {t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field: nameLabel })}
              </FieldError>
            </Field>

            <ResourceSelector
              initialResources={initialResources}
              selectedResources={selectedResources}
              onToggle={toggleResource}
            />

            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isSaving || !name.trim() || selectedResources.size === 0}
              >
                {isEdit
                  ? t(($) => $['operation.save'], { ns: 'common' })
                  : t(($) => $['operation.create'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
