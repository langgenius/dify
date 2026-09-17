'use client'

import type { FormEvent } from 'react'
import type { AccessControlDraft, AccessControlPolicy } from './draft'
import type { AccessControlAppIcon } from './index'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTitle } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { canSaveAccessControl, hasSelectedAccessPoint } from './draft'
import { AccessControlPolicyField } from './policy-field'
import { AccessControlScopeList } from './scope-list'

type AccessControlConfigPanelProps = {
  draft: AccessControlDraft
  policies: readonly AccessControlPolicy[]
  currentIp?: string
  availableAccessPoints: readonly AccessPoint[]
  appIcon: AccessControlAppIcon
  readOnly?: boolean
  canManagePolicies: boolean
  baseline?: AccessControlDraft
  showBack?: boolean
  saving?: boolean
  onBack?: () => void
  onCancel: () => void
  onCreatePolicy: () => void
  onManagePolicies: () => void
  onDraftChange: (draft: AccessControlDraft) => void
  onSave: () => void
}

export function AccessControlConfigPanel({
  draft,
  policies,
  currentIp,
  availableAccessPoints,
  appIcon,
  readOnly = false,
  canManagePolicies,
  baseline,
  showBack = false,
  saving = false,
  onBack,
  onCancel,
  onCreatePolicy,
  onManagePolicies,
  onDraftChange,
  onSave,
}: AccessControlConfigPanelProps) {
  const { t } = useTranslation()
  const title = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const hasSelectedPolicy = Boolean(draft.selectedPolicyId)
  const hasPersistableSelection = hasSelectedAccessPoint(draft, availableAccessPoints)
  const canSave = !readOnly && canSaveAccessControl({ draft, baseline, availableAccessPoints })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    onSave()
  }

  return (
    <form className="flex w-100 flex-col" onSubmit={handleSubmit}>
      <div
        className={cn(
          'flex items-center overflow-hidden pt-4 pr-4 pb-3',
          showBack ? 'pl-2' : 'pl-4',
        )}
      >
        <div className="flex w-full items-center gap-2 overflow-hidden">
          {showBack && (
            <IconButton
              size="lg"
              aria-label={t(($) => $['operation.back'], { ns: 'common' })}
              onClick={onBack}
            >
              <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
            </IconButton>
          )}
          <PopoverTitle className="min-w-0 flex-1 system-md-semibold text-text-primary">
            {title}
          </PopoverTitle>
        </div>
      </div>

      <div className="flex flex-col gap-5 overflow-hidden px-4 pt-2 pb-4">
        <Fieldset className="flex w-full flex-col gap-1">
          <FieldsetLegend className="mb-0 py-0">
            {t(($) => $['studio.accessControl.ipPolicy'], { ns: 'deployments' })}
          </FieldsetLegend>
          <AccessControlPolicyField
            policies={policies}
            selectedPolicyId={draft.selectedPolicyId}
            currentIp={currentIp}
            readOnly={readOnly}
            canManagePolicies={canManagePolicies}
            onCreatePolicy={onCreatePolicy}
            onManagePolicies={onManagePolicies}
            onSelectPolicy={(policyId) => {
              if (readOnly) return
              onDraftChange({ ...draft, selectedPolicyId: policyId })
            }}
          />
        </Fieldset>

        <Fieldset className="flex w-full flex-col gap-1">
          <FieldsetLegend className="mb-0 py-0">
            {t(($) => $['studio.accessControl.applyTo'], { ns: 'deployments' })}
          </FieldsetLegend>
          <p className="system-xs-regular text-text-tertiary">
            {hasSelectedPolicy
              ? t(($) => $['studio.accessControl.applyToHelpSelected'], { ns: 'deployments' })
              : t(($) => $['studio.accessControl.applyToHelp'], { ns: 'deployments' })}
          </p>
          <AccessControlScopeList
            draft={draft}
            appIcon={appIcon}
            availableAccessPoints={availableAccessPoints}
            readOnly={readOnly}
            onDraftChange={onDraftChange}
          />
          {hasSelectedPolicy && draft.enabled && !hasPersistableSelection && (
            <p className="system-xs-regular text-text-warning">
              {t(($) => $['studio.accessControl.selectAccessPoint'], { ns: 'deployments' })}
            </p>
          )}
        </Fieldset>

        <div className="flex items-center justify-end gap-2 pt-5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          {!readOnly && (
            <Button type="submit" variant="primary" disabled={!canSave || saving} loading={saving}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
