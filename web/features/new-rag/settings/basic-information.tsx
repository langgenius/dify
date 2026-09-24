'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useMembers } from '@/service/use-common'
import { KnowledgeSpaceIcon } from '../components/knowledge-space-icon'
import { KNOWLEDGE_DESCRIPTION_MAX_LENGTH, KNOWLEDGE_NAME_MAX_LENGTH } from '../constants'
import { KnowledgeSettingsMembers } from './members'
import { SettingsFieldRow } from './settings-field-row'
import {
  knowledgeSettingsBasicDraftAtom,
  knowledgeSettingsValidationAtom,
  updateKnowledgeSettingsBasicDraftAtom,
} from './state/draft'
import { knowledgeSettingsSpaceAtom } from './state/queries'
import { knowledgeSettingsInteractionLockedAtom } from './state/workflow'

const NAME_ERROR_ID = 'knowledge-name-error'
const DESCRIPTION_ERROR_ID = 'knowledge-description-error'

function BasicInformationSkeleton() {
  const { t } = useTranslation(['knowledgeSettings'])
  const { t: tSettings } = useTranslation(['datasetSettings'])

  return (
    <div className="flex flex-col gap-4 pt-2">
      <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
        {t(($) => $['settings.basicInfo'], { ns: 'knowledgeSettings' })}
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
  const { t } = useTranslation(['knowledgeSettings'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tSettings } = useTranslation(['datasetSettings'])
  const { t: tWorkflow } = useTranslation(['workflow'])
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const current = useAtomValue(knowledgeSettingsBasicDraftAtom)
  const updateDraft = useSetAtom(updateKnowledgeSettingsBasicDraftAtom)
  const interactionLocked = useAtomValue(knowledgeSettingsInteractionLockedAtom)
  const { nameInvalid, descriptionInvalid, membersInvalid } = useAtomValue(
    knowledgeSettingsValidationAtom,
  )
  const membersQuery = useMembers()
  const [nameTouched, setNameTouched] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  if (!space || !current) return null
  if (membersQuery.isPending) return <BasicInformationSkeleton />
  if (membersQuery.isError && !membersQuery.data) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-components-panel-border bg-background-section p-4"
        role="alert"
      >
        <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
        <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
          {tCommon(($) => $['api.actionFailed'])}
        </p>
        <Button type="button" onClick={() => void membersQuery.refetch()}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </div>
    )
  }

  const canEdit = space.permission_keys.includes('knowledge_space_edit')
  const canManageAccess = space.permission_keys.includes('knowledge_space_access_config')
  const fieldsDisabled = !canEdit || interactionLocked
  const updateEditableDraft = (patch: Parameters<typeof updateDraft>[0]) => {
    if (!fieldsDisabled) updateDraft(patch)
  }

  return (
    <>
      <section className="flex flex-col gap-4 overflow-hidden pt-2">
        <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
          {t(($) => $['settings.basicInfo'], { ns: 'knowledgeSettings' })}
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
                  updateEditableDraft({
                    name: event.target.value.slice(0, KNOWLEDGE_NAME_MAX_LENGTH),
                  })
                }
              />
              {nameTouched && nameInvalid && (
                <p
                  id={NAME_ERROR_ID}
                  className="mt-1 system-xs-regular text-text-destructive"
                  role="alert"
                >
                  {t(($) => $['settings.nameRequired'], { ns: 'knowledgeSettings' })}
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
              placeholder={t(($) => $['settings.descriptionPlaceholder'], {
                ns: 'knowledgeSettings',
              })}
              className={cn(
                'min-h-20 resize-none',
                descriptionInvalid && 'ring-1 ring-text-destructive',
              )}
              onValueChange={(description) => updateEditableDraft({ description })}
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
            disabled={!canManageAccess || interactionLocked}
            hasError={membersInvalid}
            members={membersQuery.data?.accounts ?? []}
            ownerAccountId={space.owner_account_id}
            selectedMemberIds={current.selectedMemberIds}
            visibility={current.visibility}
            visibilityDisabled={!canEdit || !canManageAccess || interactionLocked}
            onSelectedMemberIdsChange={(selectedMemberIds) =>
              !interactionLocked && canManageAccess && updateDraft({ selectedMemberIds })
            }
            onVisibilityChange={(visibility) => {
              if (!interactionLocked && canEdit && canManageAccess) updateDraft({ visibility })
            }}
          />
        </SettingsFieldRow>
      </section>

      <AppIconPicker
        open={iconPickerOpen && !fieldsDisabled}
        enableImageUpload={false}
        initialEmoji={{ background: current.iconBackground, icon: current.icon }}
        onOpenChange={setIconPickerOpen}
        onSelect={(selection) => {
          if (selection.type !== 'emoji' || fieldsDisabled) return
          updateDraft({
            icon: selection.icon,
            iconBackground: selection.background,
          })
        }}
      />
    </>
  )
}
