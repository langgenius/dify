'use client'

import type { ChangeEvent } from 'react'
import type { DocumentMetadataType } from './document-metadata-model'
import type { LogicalDocument } from './document-models'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  documentMetadataDefaultValue,
  documentMetadataFieldsQueryOptions,
  documentMetadataNameError,
  documentMetadataType,
  editableDocumentMetadataEntries,
} from './document-metadata-model'
import { DocumentMetadataPicker } from './document-metadata-picker'
import { logicalDocumentFromApi } from './document-models'
import { newKnowledgeDocumentsPath } from './routes'

type MetadataDraft = {
  id: string
  name: string
  type: DocumentMetadataType
  value: string
}

function metadataValueForInput(value: unknown, type: DocumentMetadataType) {
  if (type === 'time' && typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      return localDate.toISOString().slice(0, 16)
    }
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

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

function metadataDrafts(
  document: LogicalDocument,
  fields: readonly { name: string; type: DocumentMetadataType }[],
): MetadataDraft[] {
  const fieldTypes = new Map(fields.map((field) => [field.name, field.type]))
  return editableDocumentMetadataEntries(document.userMetadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      const type = fieldTypes.get(name) ?? documentMetadataType(value)
      return {
        id: `field-${name}`,
        name,
        type,
        value: metadataValueForInput(value, type),
      }
    })
}

export function DocumentMetadataCard({
  canEdit,
  controlSpaceId,
  document,
  locale,
}: {
  canEdit: boolean
  controlSpaceId: string
  document: LogicalDocument
  locale: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const [drafts, setDrafts] = useState<MetadataDraft[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [retryableCreateName, setRetryableCreateName] = useState<string>()
  const [editBaseline, setEditBaseline] = useState(() => ({
    metadata: document.userMetadata,
    rowVersion: document.rowVersion,
  }))
  const entries = useMemo(
    () =>
      editableDocumentMetadataEntries(document.userMetadata).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [document.userMetadata],
  )
  const metadataFieldsQuery = useQuery({
    ...documentMetadataFieldsQueryOptions(controlSpaceId),
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

  const startEditing = () => {
    if (!canEdit) return
    setEditBaseline({ metadata: document.userMetadata, rowVersion: document.rowVersion })
    setDrafts(metadataDrafts(document, fields))
    setEditing(true)
  }

  const cancelEditing = () => {
    setDrafts([])
    setEditing(false)
  }

  const createField = async (rawName: string, type: DocumentMetadataType) => {
    if (!canEdit || creating) return
    const name = rawName.trim()
    const nameError = documentMetadataNameError(name, fields, retryableCreateName)
    if (nameError) {
      toast.error(t(($) => $[`metadata.checkName.${nameError}`], { max: 255 }))
      throw new Error(`metadata name is ${nameError}`)
    }

    setCreating(true)
    try {
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
      const currentDocument = logicalDocumentFromApi(response)
      setEditBaseline({
        metadata: currentDocument.userMetadata,
        rowVersion: currentDocument.rowVersion,
      })
      setDrafts((current) => {
        if (current.some((draft) => draft.name === name)) return current
        return [
          ...current,
          {
            id: `field-${name}`,
            name,
            type,
            value: metadataValueForInput(defaultValue, type),
          },
        ]
      })
      setRetryableCreateName(undefined)
      await invalidateMetadataQueries()
      toast.success(tCommon(($) => $['api.actionSuccess']))
    } catch (error) {
      setRetryableCreateName(name)
      toast.error(t(($) => $['newKnowledge.settings.saveFailed']))
      throw error
    } finally {
      setCreating(false)
    }
  }

  const save = async () => {
    if (!canEdit || saving) return
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

    setSaving(true)
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.documents.byDocumentId.patch({
        body: { expectedRowVersion: editBaseline.rowVersion, patch },
        params: {
          control_space_id: controlSpaceId,
          document_id: document.id,
        },
      })
      await invalidateMetadataQueries()
      cancelEditing()
      toast.success(tCommon(($) => $['api.actionSuccess']))
    } catch {
      toast.error(t(($) => $['newKnowledge.settings.saveFailed']))
    } finally {
      setSaving(false)
    }
  }

  if (!editing && !entries.length)
    return (
      <section className="rounded-xl bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4 pt-3">
        <h2 className="text-xs/5 font-semibold text-text-secondary">
          {t(($) => $['metadata.metadata'])}
        </h2>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['metadata.documentMetadata.metadataToolTip'])}
        </p>
        <Button className="mt-2" disabled={!canEdit} onClick={startEditing} variant="primary">
          {t(($) => $['metadata.documentMetadata.startLabeling'])}
          <span aria-hidden className="ml-1 i-ri-arrow-right-line size-4" />
        </Button>
      </section>
    )

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="system-md-semibold text-text-secondary">
          {t(($) => $['metadata.metadata'])}
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
            onSelect={(field) => {
              setDrafts((current) => {
                if (current.some((draft) => draft.name === field.name)) return current
                return [
                  ...current,
                  {
                    id: `field-${field.name}`,
                    name: field.name,
                    type: field.type,
                    value: '',
                  },
                ]
              })
            }}
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
                        setDrafts((current) =>
                          current.map((draft) =>
                            draft.id === item.id ? { ...draft, value: event.target.value } : draft,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label={`${tCommon(($) => $['operation.remove'])} ${item.name}`}
                      className="shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                      onClick={() =>
                        setDrafts((current) => current.filter((draft) => draft.id !== item.id))
                      }
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
            onClick={() => void save()}
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
