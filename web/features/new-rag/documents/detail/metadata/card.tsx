'use client'

import type { ChangeEvent } from 'react'
import type { DocumentMetadataType } from '../../metadata/editor-model'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { knowledgeFsMetadataFieldsQueryOptions } from '@/service/knowledge-fs/metadata'
import { newKnowledgeDocumentsPath } from '../../../routes'
import {
  documentMetadataDefaultValue,
  documentMetadataNameError,
  documentMetadataType,
  editableDocumentMetadataEntries,
} from '../../metadata/editor-model'
import { DocumentMetadataPicker } from '../../metadata/picker'
import { logicalDocumentFromApi } from '../../models'
import { documentDetailKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentDetailDocumentAtom } from '../state/queries'
import { documentCanEditAtom } from '../state/workflow'
import {
  cancelMetadataEditingAtom,
  markMetadataCreateRetryableAtom,
  metadataDraftsAtom,
  metadataEditBaselineAtom,
  metadataEditingAtom,
  metadataEditorScopedAtoms,
  metadataRetryableCreateNameAtom,
  recordCreatedMetadataFieldAtom,
  removeMetadataDraftAtom,
  selectMetadataFieldAtom,
  startMetadataEditingAtom,
  updateMetadataDraftValueAtom,
} from './state'

function metadataValueFromInput(value: string, type: DocumentMetadataType) {
  if (!value) return ''
  if (type === 'number') return Number(value)
  if (type === 'time') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return value
}

function metadataDisplayValue(value: unknown, locale: string) {
  if (typeof value === 'string') {
    const type = documentMetadataType(value)
    if (type === 'time') {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime()))
        return new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(date)
    }
    return value || '—'
  }
  if (typeof value === 'number') return new Intl.NumberFormat(locale).format(value)
  if (value === undefined || value === null) return '—'
  return JSON.stringify(value)
}

function DocumentMetadataCardContent() {
  const { i18n, t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const canEdit = useAtomValue(documentCanEditAtom)
  const controlSpaceId = useAtomValue(documentDetailKnowledgeSpaceIdAtom)
  const document = useAtomValue(documentDetailDocumentAtom)
  const drafts = useAtomValue(metadataDraftsAtom)
  const editing = useAtomValue(metadataEditingAtom)
  const editBaseline = useAtomValue(metadataEditBaselineAtom)
  const retryableCreateName = useAtomValue(metadataRetryableCreateNameAtom)
  const beginEditing = useSetAtom(startMetadataEditingAtom)
  const cancelEditing = useSetAtom(cancelMetadataEditingAtom)
  const markCreateRetryable = useSetAtom(markMetadataCreateRetryableAtom)
  const recordCreatedField = useSetAtom(recordCreatedMetadataFieldAtom)
  const removeDraft = useSetAtom(removeMetadataDraftAtom)
  const selectField = useSetAtom(selectMetadataFieldAtom)
  const updateDraftValue = useSetAtom(updateMetadataDraftValueAtom)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const entries = useMemo(
    () =>
      editableDocumentMetadataEntries(document.userMetadata).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [document.userMetadata],
  )
  const metadataFieldsQuery = useQuery({
    ...knowledgeFsMetadataFieldsQueryOptions(controlSpaceId),
    enabled: editing,
  })
  const fields = useMemo(() => metadataFieldsQuery.data ?? [], [metadataFieldsQuery.data])
  const resolvedDrafts = useMemo(() => {
    const fieldTypes = new Map(fields.map((field) => [field.name, field.type]))
    return drafts.map((draft) => ({
      ...draft,
      type: fieldTypes.get(draft.name) ?? draft.type,
    }))
  }, [drafts, fields])
  const renderedItems = useMemo(
    () =>
      editing
        ? resolvedDrafts.map((draft) => ({
            id: draft.id,
            name: draft.name,
            type: draft.type,
            value: draft.value,
          }))
        : entries.map(([name, value]) => ({
            id: `field-${name}`,
            name,
            type: documentMetadataType(value),
            value,
          })),
    [editing, entries, resolvedDrafts],
  )

  const invalidateMetadataQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey:
          consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.metadata.get.key(),
      }),
    ])
  }

  const createFieldMutation = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: DocumentMetadataType }) => {
      if (!editBaseline) throw new Error('Missing metadata edit baseline')
      const defaultValue = documentMetadataDefaultValue(type)
      if (retryableCreateName !== name) {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.metadata.post({
          body: { name, type },
          params: { control_space_id: controlSpaceId },
        })
      }
      const response =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
          body: { expectedRowVersion: editBaseline.rowVersion, patch: { [name]: defaultValue } },
          params: {
            control_space_id: controlSpaceId,
            document_id: document.id,
          },
        })
      return { document: logicalDocumentFromApi(response), name, type, value: defaultValue }
    },
    onError: (_error, { name }) => {
      markCreateRetryable(name)
      toast.error(t(($) => $['settings.saveFailed']))
    },
    onSuccess: async (createdField) => {
      recordCreatedField(createdField)
      await invalidateMetadataQueries()
      toast.success(tCommon(($) => $['api.actionSuccess']))
    },
  })

  const saveMutation = useMutation({
    mutationFn: async ({
      patch,
      rowVersion,
    }: {
      patch: Record<string, unknown>
      rowVersion: number
    }) =>
      consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
        body: { expectedRowVersion: rowVersion, patch },
        params: {
          control_space_id: controlSpaceId,
          document_id: document.id,
        },
      }),
    onError: () => {
      toast.error(t(($) => $['settings.saveFailed']))
    },
    onSuccess: async () => {
      await invalidateMetadataQueries()
      cancelEditing()
      toast.success(tCommon(($) => $['api.actionSuccess']))
    },
  })

  const startEditing = () => {
    if (canEdit) beginEditing({ document, fields })
  }

  const createField = async (rawName: string, type: DocumentMetadataType) => {
    if (!canEdit || createFieldMutation.isPending) return
    const name = rawName.trim()
    const nameError = documentMetadataNameError(name, fields, retryableCreateName)
    if (nameError) {
      toast.error(t(($) => $[`metadata.checkName.${nameError}`], { max: 255, ns: 'dataset' }))
      throw new Error(`metadata name is ${nameError}`)
    }
    await createFieldMutation.mutateAsync({ name, type })
  }

  const save = () => {
    if (!canEdit || saveMutation.isPending || !editBaseline) return
    const patch: Record<string, unknown> = {}
    const original = new Map(editableDocumentMetadataEntries(editBaseline.metadata))
    const nextNames = new Set(resolvedDrafts.map((draft) => draft.name))
    for (const name of original.keys()) {
      if (!nextNames.has(name)) patch[name] = null
    }
    for (const draft of resolvedDrafts) {
      const value = metadataValueFromInput(draft.value, draft.type)
      if (!original.has(draft.name) || !Object.is(original.get(draft.name), value))
        patch[draft.name] = value
    }

    if (!Object.keys(patch).length) {
      cancelEditing()
      return
    }
    saveMutation.mutate({ patch, rowVersion: editBaseline.rowVersion })
  }

  const creating = createFieldMutation.isPending
  const saving = saveMutation.isPending

  if (!editing && !entries.length)
    return (
      <section className="rounded-xl bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4 pt-3">
        <h2 className="text-xs/5 font-semibold text-text-secondary">
          {t(($) => $['metadata.metadata'], { ns: 'dataset' })}
        </h2>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['metadata.documentMetadata.metadataToolTip'], { ns: 'dataset' })}
        </p>
        <Button className="mt-2" disabled={!canEdit} onClick={startEditing} variant="primary">
          {t(($) => $['metadata.documentMetadata.startLabeling'], { ns: 'dataset' })}
          <span aria-hidden className="ml-1 i-ri-arrow-right-line size-4" />
        </Button>
      </section>
    )

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="system-md-semibold text-text-secondary">
          {t(($) => $['metadata.metadata'], { ns: 'dataset' })}
        </h2>
        {!editing && canEdit && (
          <Button onClick={startEditing} size="small" variant="ghost">
            <span aria-hidden className="mr-1 i-ri-edit-line size-3.5" />
            {tCommon(($) => $['operation.edit'])}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3">
          <DocumentMetadataPicker
            allowedExistingName={retryableCreateName}
            creating={creating}
            error={Boolean(metadataFieldsQuery.error)}
            fields={fields}
            loading={metadataFieldsQuery.isPending || metadataFieldsQuery.isFetching}
            onCreate={createField}
            onManage={() => router.push(`${newKnowledgeDocumentsPath(controlSpaceId)}?metadata=1`)}
            onRetry={() => void metadataFieldsQuery.refetch()}
            onSelect={selectField}
          />
          {drafts.length > 0 && <div className="my-3 h-px bg-divider-subtle" />}
        </div>
      )}

      <dl className="mt-3 space-y-1">
        {renderedItems.map((item) => {
          return (
            <div key={item.id} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
              <dt className="truncate system-xs-medium text-text-secondary" title={item.name}>
                {item.name}
              </dt>
              <dd className="min-w-0">
                {editing ? (
                  <div className="flex items-center gap-0.5">
                    <Input
                      aria-label={item.name}
                      className="h-6 min-w-0 flex-1"
                      type={
                        item.type === 'number'
                          ? 'number'
                          : item.type === 'time'
                            ? 'datetime-local'
                            : 'text'
                      }
                      value={String(item.value)}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        updateDraftValue({ draftId: item.id, value: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`${tCommon(($) => $['operation.remove'])} ${item.name}`}
                      className="shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                      onClick={() => removeDraft(item.id)}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="py-1 system-xs-regular wrap-break-word text-text-secondary">
                    {metadataDisplayValue(item.value, locale)}
                  </div>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {editing && (
        <div className="mt-3 flex justify-end gap-2">
          <Button disabled={saving || creating} onClick={cancelEditing} size="small">
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            disabled={creating}
            loading={saving}
            onClick={save}
            size="small"
            variant="primary"
          >
            {tCommon(($) => $['operation.save'])}
          </Button>
        </div>
      )}
    </section>
  )
}

export function DocumentMetadataCard() {
  const documentId = useAtomValue(documentDetailDocumentAtom).id

  return (
    <ScopeProvider key={documentId} atoms={metadataEditorScopedAtoms} name="DocumentMetadata">
      <DocumentMetadataCardContent />
    </ScopeProvider>
  )
}
