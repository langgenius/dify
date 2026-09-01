'use client'

import type {
  KnowledgeFsControlSpaceVisibility,
  KnowledgeFsPermissionResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import {
  DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND,
  KnowledgeSpaceIcon,
} from '../components/knowledge-space-icon'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from '../constants'
import { KnowledgeSettingsMembers } from './members'
import { SettingsFieldRow } from './settings-field-row'
import {
  invalidateKnowledgeSettingsAtom,
  knowledgeSettingsPermissionsAtom,
  knowledgeSettingsSpaceAtom,
} from './state/queries'
import { setKnowledgeSettingsSavePendingAtom } from './state/workflow'

const NAME_ERROR_ID = 'knowledge-name-error'
const DESCRIPTION_ERROR_ID = 'knowledge-description-error'
type BasicSaveSlice = 'members' | 'space'

type BasicDraft = {
  description: string
  icon: string
  iconBackground: string
  name: string
  selectedMemberIds: string[]
  visibility: KnowledgeFsControlSpaceVisibility
}

function sortedIds(ids: string[]) {
  return [...ids].sort().join(':')
}

function draftFromServer(
  space: KnowledgeFsSpaceDetailResponse,
  permissions: KnowledgeFsPermissionResponse[],
): BasicDraft {
  return {
    description: space.technical_summary?.description ?? '',
    icon: space.technical_summary?.icon ?? '📙',
    iconBackground:
      space.technical_summary?.icon_background ?? DEFAULT_KNOWLEDGE_SPACE_ICON_BACKGROUND,
    name: space.technical_summary?.name ?? '',
    selectedMemberIds: permissions
      .filter(
        (permission) =>
          permission.status === 'active' && permission.account_id !== space.owner_account_id,
      )
      .map((permission) => permission.account_id),
    visibility: space.visibility,
  }
}

function draftsMatch(left: BasicDraft, right: BasicDraft) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.icon === right.icon &&
    left.iconBackground === right.iconBackground &&
    left.visibility === right.visibility &&
    sortedIds(left.selectedMemberIds) === sortedIds(right.selectedMemberIds)
  )
}

function BasicInformationSkeleton() {
  const { t } = useTranslation('dataset')
  const { t: tSettings } = useTranslation('datasetSettings')

  return (
    <div className="flex flex-col gap-4 pt-2">
      <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
        {t(($) => $['newKnowledge.settings.basicInfo'])}
      </h2>
      {[
        tSettings(($) => $['form.nameAndIcon']),
        tSettings(($) => $['form.desc']),
        tSettings(($) => $['form.permissions']),
      ].map((label) => (
        <SettingsFieldRow key={label} label={label}>
          <SkeletonRectangle className="h-9 w-full rounded-lg" />
        </SettingsFieldRow>
      ))}
    </div>
  )
}

export function BasicInformationSection() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const { t: tWorkflow } = useTranslation('workflow')
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const permissions = useAtomValue(knowledgeSettingsPermissionsAtom)
  const setSavePending = useSetAtom(setKnowledgeSettingsSavePendingAtom)
  const invalidateSettings = useSetAtom(invalidateKnowledgeSettingsAtom)
  const membersQuery = useMembers()
  const [draft, setDraft] = useState<BasicDraft>()
  const [nameTouched, setNameTouched] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const draftRef = useRef<BasicDraft | undefined>(undefined)
  const draftBaseVersionRef = useRef<string | undefined>(undefined)
  const completedSaveFingerprintsRef = useRef<Partial<Record<BasicSaveSlice, string>>>({})
  const spaceMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.patch.mutationOptions(),
  )
  const membersMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.members.put.mutationOptions(),
  )

  if (!space) return null
  if (membersQuery.isPending) return <BasicInformationSkeleton />
  if (membersQuery.isError) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-components-panel-border bg-background-section p-4"
        role="alert"
      >
        <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
        <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
          {tCommon(($) => $['api.actionFailed'])}
        </p>
        <Button onClick={() => void membersQuery.refetch()}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </div>
    )
  }

  const serverDraft = draftFromServer(space, permissions)
  const serverVersion = [
    space.control_space_id,
    space.resource_version,
    permissions
      .map((permission) => `${permission.account_id}:${permission.revision}`)
      .sort()
      .join('|'),
  ].join(':')
  const current = draft ?? serverDraft
  const serverConflict =
    draft !== undefined &&
    draftBaseVersionRef.current !== undefined &&
    draftBaseVersionRef.current !== serverVersion
  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
  const basicDirty = !draftsMatch(current, serverDraft)
  const spaceDirty =
    current.name !== serverDraft.name ||
    current.description !== serverDraft.description ||
    current.icon !== serverDraft.icon ||
    current.iconBackground !== serverDraft.iconBackground ||
    current.visibility !== serverDraft.visibility
  const membersDirty =
    sortedIds(current.selectedMemberIds) !== sortedIds(serverDraft.selectedMemberIds)
  const nameInvalid = !current.name.trim()
  const descriptionInvalid =
    Array.from(current.description).length > KNOWLEDGE_DESCRIPTION_MAX_LENGTH
  const membersInvalid =
    canManageAccess &&
    current.visibility === 'partial_members' &&
    current.selectedMemberIds.length === 0
  const isSaving = spaceMutation.isPending || membersMutation.isPending || isRefreshing
  const fieldsDisabled = !canEdit || isSaving
  const saveDisabled =
    !basicDirty || nameInvalid || descriptionInvalid || membersInvalid || serverConflict

  const updateDraft = (update: (value: BasicDraft) => BasicDraft) => {
    const next = update(draftRef.current ?? current)
    if (draftsMatch(next, serverDraft)) {
      draftRef.current = undefined
      draftBaseVersionRef.current = undefined
      setDraft(undefined)
      return
    }
    draftRef.current = next
    draftBaseVersionRef.current ??= serverVersion
    setDraft(next)
  }

  const resetDraft = () => {
    draftRef.current = undefined
    draftBaseVersionRef.current = undefined
    setDraft(undefined)
    setNameTouched(false)
  }

  const showSaveError = (error?: unknown) =>
    toast.error(
      error instanceof Response && error.status === 403
        ? t(($) => $['newKnowledge.permissionRestricted'])
        : t(($) => $['newKnowledge.settings.saveFailed']),
    )

  const performSave = async () => {
    if (saveDisabled || isSaving || !canEdit) return
    setSavePending({ owner: 'basic', pending: true })
    try {
      const saveSlice = async (
        slice: BasicSaveSlice,
        payload: unknown,
        save: () => Promise<unknown>,
      ) => {
        const fingerprint = JSON.stringify(payload)
        if (completedSaveFingerprintsRef.current[slice] === fingerprint) return
        await save()
        completedSaveFingerprintsRef.current[slice] = fingerprint
      }

      if (spaceDirty) {
        const body = {
          ...(current.description !== serverDraft.description
            ? { description: current.description }
            : {}),
          ...(current.icon !== serverDraft.icon ? { icon: current.icon } : {}),
          ...(current.iconBackground !== serverDraft.iconBackground
            ? { icon_background: current.iconBackground }
            : {}),
          ...(current.name !== serverDraft.name ? { name: current.name.trim() } : {}),
          ...(current.visibility !== serverDraft.visibility
            ? { visibility: current.visibility }
            : {}),
        }
        await saveSlice('space', body, () =>
          spaceMutation.mutateAsync({
            body,
            params: { control_space_id: space.control_space_id },
          }),
        )
      }
      if (membersDirty && canManageAccess) {
        const roleByAccountId = new Map(
          permissions.map((permission) => [permission.account_id, permission.role]),
        )
        const body = {
          members: current.selectedMemberIds.map((accountId) => ({
            account_id: accountId,
            role: roleByAccountId.get(accountId) ?? 'viewer',
          })),
        }
        await saveSlice('members', body, () =>
          membersMutation.mutateAsync({
            body,
            params: { control_space_id: space.control_space_id },
          }),
        )
      }
      completedSaveFingerprintsRef.current = {}
      toast.success(tCommon(($) => $['api.actionSuccess']))
      setIsRefreshing(true)
      draftBaseVersionRef.current = undefined
      void invalidateSettings().then(
        () => {
          draftRef.current = undefined
          setDraft(undefined)
          setIsRefreshing(false)
          setSavePending({ owner: 'basic', pending: false })
        },
        () => {
          setIsRefreshing(false)
          setSavePending({ owner: 'basic', pending: false })
        },
      )
    } catch (error) {
      setSavePending({ owner: 'basic', pending: false })
      showSaveError(error)
    }
  }

  return (
    <>
      {serverConflict && (
        <div
          className="mb-3 flex items-center gap-2 rounded-lg border border-text-warning/20 bg-state-warning-hover px-3 py-2"
          role="alert"
        >
          <span aria-hidden className="i-ri-error-warning-line size-4 text-text-warning" />
          <span className="min-w-0 flex-1 system-xs-regular text-text-warning">
            {t(($) => $['newKnowledge.settings.serverConflict'])}
          </span>
        </div>
      )}

      <Form
        className="flex flex-col gap-4 overflow-hidden pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          setNameTouched(true)
          void performSave()
        }}
      >
        <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
          {t(($) => $['newKnowledge.settings.basicInfo'])}
        </h2>

        <SettingsFieldRow label={tSettings(($) => $['form.nameAndIcon'])}>
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label={tSettings(($) => $['form.nameAndIcon'])}
              disabled={fieldsDisabled}
              className="shrink-0 rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed"
              onClick={() => setIconPickerOpen(true)}
            >
              <KnowledgeSpaceIcon
                background={current.iconBackground}
                icon={current.icon}
                size="small"
              />
            </button>
            <div className="min-w-0 flex-1">
              <Input
                aria-label={tSettings(($) => $['form.name'])}
                aria-describedby={nameTouched && nameInvalid ? NAME_ERROR_ID : undefined}
                aria-invalid={nameTouched && nameInvalid}
                autoComplete="off"
                name="knowledge-name"
                value={current.name}
                maxLength={KNOWLEDGE_NAME_MAX_LENGTH}
                disabled={fieldsDisabled}
                className={cn(nameTouched && nameInvalid && 'ring-1 ring-text-destructive')}
                onBlur={() => setNameTouched(true)}
                onChange={(event) =>
                  updateDraft((value) => ({
                    ...value,
                    name: event.target.value.slice(0, KNOWLEDGE_NAME_MAX_LENGTH),
                  }))
                }
              />
              {nameTouched && nameInvalid && (
                <p
                  id={NAME_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                  role="alert"
                >
                  {t(($) => $['newKnowledge.settings.nameRequired'])}
                </p>
              )}
              {current.name.length >= KNOWLEDGE_NAME_MAX_LENGTH * 0.9 && (
                <p className="mt-1 text-right system-xs-medium text-text-warning-secondary">
                  {current.name.length} / {KNOWLEDGE_NAME_MAX_LENGTH}
                </p>
              )}
            </div>
          </div>
        </SettingsFieldRow>

        <SettingsFieldRow label={tSettings(($) => $['form.desc'])}>
          <div>
            <Textarea
              aria-label={tSettings(($) => $['form.desc'])}
              aria-describedby={descriptionInvalid ? DESCRIPTION_ERROR_ID : undefined}
              aria-invalid={descriptionInvalid}
              autoComplete="off"
              name="knowledge-description"
              value={current.description}
              disabled={fieldsDisabled}
              placeholder={t(($) => $['newKnowledge.settings.descriptionPlaceholder'])}
              className={cn(
                'min-h-20 resize-none',
                descriptionInvalid && 'ring-1 ring-text-destructive',
              )}
              onValueChange={(description) => updateDraft((value) => ({ ...value, description }))}
            />
            {descriptionInvalid && (
              <p
                id={DESCRIPTION_ERROR_ID}
                className="mt-1 system-xs-regular text-text-destructive"
                role="alert"
              >
                {tWorkflow(($) => $['chatVariable.modal.descriptionTooLong'], {
                  maxLength: KNOWLEDGE_DESCRIPTION_MAX_LENGTH,
                })}
              </p>
            )}
          </div>
        </SettingsFieldRow>

        <SettingsFieldRow label={tSettings(($) => $['form.permissions'])}>
          <KnowledgeSettingsMembers
            disabled={!canEdit || !canManageAccess || isSaving}
            hasError={membersInvalid}
            members={membersQuery.data?.accounts ?? []}
            ownerAccountId={space.owner_account_id}
            selectedMemberIds={current.selectedMemberIds}
            visibility={current.visibility}
            onSelectedMemberIdsChange={(selectedMemberIds) =>
              updateDraft((value) => ({ ...value, selectedMemberIds }))
            }
            onVisibilityChange={(visibility) => updateDraft((value) => ({ ...value, visibility }))}
          />
        </SettingsFieldRow>

        {canEdit && (
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              disabled={(!basicDirty && !serverConflict) || isSaving}
              onClick={resetDraft}
            >
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button type="submit" variant="primary" disabled={saveDisabled} loading={isSaving}>
              {t(($) => $['newKnowledge.settings.saveChanges'])}
            </Button>
          </div>
        )}
      </Form>

      <AppIconPicker
        open={iconPickerOpen}
        enableImageUpload={false}
        initialEmoji={{ background: current.iconBackground, icon: current.icon }}
        onOpenChange={setIconPickerOpen}
        onSelect={(selection) => {
          if (selection.type !== 'emoji') return
          updateDraft((value) => ({
            ...value,
            icon: selection.icon,
            iconBackground: selection.background,
          }))
        }}
      />
    </>
  )
}
