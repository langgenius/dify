'use client'

import type { MouseEvent, PropsWithChildren } from 'react'
import type { AccessPermissionKind, SelectableAccessSubject } from './access-policy'
import type { AccessSubjectSelectionValue } from './access-subject-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode as AppAccessMode } from '@/models/access-control'
import {
  accessControlSelectionFromSubjects,
  appAccessModeToPermissionKey,
  permissionKeyToAppAccessMode,
  subjectsFromAccessControlSelection,
} from './access-policy'
import { AccessSubjectAddButton } from './access-subject-selector/add-button'
import { AccessSubjectSelectionList } from './access-subject-selector/selection-list'

export function DeploymentAccessControlDialog({
  open,
  initialKind,
  initialSubjects,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  initialKind: AccessPermissionKind
  initialSubjects: SelectableAccessSubject[]
  saving?: boolean
  onClose: () => void
  onSubmit: (kind: AccessPermissionKind, subjects: SelectableAccessSubject[]) => void
}) {
  const draftKey = [
    initialKind,
    initialSubjects.map(subject => `${subject.subjectType}:${subject.id}`).join(','),
  ].join(':')

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={open => !open && onClose()}>
      <DialogContent
        className={cn(
          'h-auto max-h-[calc(100dvh-2rem)] min-h-[323px] w-[600px] max-w-none overflow-y-auto rounded-2xl border-none bg-components-panel-bg p-0 shadow-xl transition-shadow',
        )}
      >
        <DialogCloseButton className="top-5 right-5 size-8" />
        {open && (
          <DeploymentAccessControlDialogBody
            key={draftKey}
            initialKind={initialKind}
            initialSubjects={initialSubjects}
            saving={saving}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DeploymentAccessControlDialogBody({
  initialKind,
  initialSubjects,
  saving,
  onClose,
  onSubmit,
}: {
  initialKind: AccessPermissionKind
  initialSubjects: SelectableAccessSubject[]
  saving?: boolean
  onClose: () => void
  onSubmit: (kind: AccessPermissionKind, subjects: SelectableAccessSubject[]) => void
}) {
  const { t } = useTranslation('deployments')
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [currentMenu, setCurrentMenu] = useState(() => permissionKeyToAppAccessMode(initialKind))
  const [specificSelection, setSpecificSelection] = useState<AccessSubjectSelectionValue>(() =>
    accessControlSelectionFromSubjects(initialSubjects),
  )
  const specificSelected = currentMenu === AppAccessMode.SPECIFIC_GROUPS_MEMBERS
  const publicAccessDisabled = !systemFeatures.webapp_auth.allow_public_access
  const selectedSubjectCount = specificSelection.groups.length + specificSelection.members.length
  const specificEmpty = specificSelected && selectedSubjectCount === 0
  const confirmDisabled = saving || (specificSelected && specificEmpty)

  const handleConfirm = () => {
    if (confirmDisabled)
      return

    onSubmit(
      appAccessModeToPermissionKey(currentMenu),
      specificSelected
        ? subjectsFromAccessControlSelection(specificSelection)
        : [],
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('access.permissions.editTitle')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {t('access.permissions.editDescription')}
        </DialogDescription>
      </div>
      <RadioGroup<AppAccessMode>
        value={currentMenu}
        onValueChange={setCurrentMenu}
        className="flex flex-col items-stretch gap-y-1 px-6 pb-3"
        aria-labelledby="access-control-options-label"
        disabled={saving}
      >
        <div className="leading-6">
          <p id="access-control-options-label" className="system-sm-medium text-text-tertiary">
            {t('accessControlDialog.accessLabel', { ns: 'app' })}
          </p>
        </div>
        <AccessControlItem type={AppAccessMode.ORGANIZATION}>
          <div className="flex items-center p-3">
            <div className="flex grow items-center gap-x-2">
              <span className="i-ri-building-line size-4 text-text-primary" aria-hidden="true" />
              <p className="system-sm-medium text-text-primary">
                {t('accessControlDialog.accessItems.organization', { ns: 'app' })}
              </p>
            </div>
          </div>
        </AccessControlItem>
        <AccessControlItem type={AppAccessMode.SPECIFIC_GROUPS_MEMBERS}>
          <SpecificGroupsOrMembersOption
            selected={specificSelected}
            selection={specificSelection}
            onSelectionChange={setSpecificSelection}
          />
        </AccessControlItem>
        <AccessControlItem type={AppAccessMode.PUBLIC} disabled={publicAccessDisabled}>
          <div className="flex items-center gap-x-2 p-3">
            <span className="i-ri-global-line size-4 text-text-primary" aria-hidden="true" />
            <p className="system-sm-medium text-text-primary">
              {t('accessControlDialog.accessItems.anyone', { ns: 'app' })}
            </p>
            {publicAccessDisabled && (
              <PublicAccessDisabledTip label={t('accessControlDialog.webAppPublicAccessDisabledTip', { ns: 'app' })} />
            )}
          </div>
        </AccessControlItem>
      </RadioGroup>
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <Button disabled={saving} onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button disabled={confirmDisabled || saving} loading={saving} variant="primary" onClick={handleConfirm}>
          {t('operation.confirm', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}

function AccessControlItem({ type, children, disabled }: PropsWithChildren<{
  type: AppAccessMode
  disabled?: boolean
}>) {
  return (
    <RadioItem<AppAccessMode>
      value={type}
      disabled={disabled}
      render={<div />}
      className={cn(
        'cursor-pointer rounded-[10px] border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg shadow-xs transition-colors',
        'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:inset-ring-[0.5px] data-checked:inset-ring-components-option-card-option-selected-border',
        'data-disabled:cursor-not-allowed data-disabled:opacity-60 data-disabled:hover:border-components-option-card-option-border data-disabled:hover:bg-components-option-card-option-bg',
      )}
    >
      {children}
    </RadioItem>
  )
}

function PublicAccessDisabledTip({ label }: { label: string }) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        aria-label={label}
        onClick={handleClick}
        className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-question-line size-3.5 text-text-warning-secondary hover:text-text-warning-secondary" />
      </PopoverTrigger>
      <PopoverContent
        placement="top"
        popupClassName="max-w-[300px] rounded-md px-3 py-2 system-xs-regular text-text-tertiary"
      >
        {label}
      </PopoverContent>
    </Popover>
  )
}

function SpecificGroupsOrMembersOption({
  selected,
  selection,
  onSelectionChange,
}: {
  selected: boolean
  selection: AccessSubjectSelectionValue
  onSelectionChange: (selection: AccessSubjectSelectionValue) => void
}) {
  const { t } = useTranslation()

  if (!selected) {
    return (
      <div className="flex items-center p-3">
        <div className="flex grow items-center gap-x-2">
          <span className="i-ri-lock-line size-4 text-text-primary" aria-hidden="true" />
          <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.specific', { ns: 'app' })}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-x-1 p-3">
        <div className="flex grow items-center gap-x-1">
          <span className="i-ri-lock-line size-4 text-text-primary" aria-hidden="true" />
          <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.specific', { ns: 'app' })}</p>
        </div>
        <div className="flex items-center gap-x-1">
          <AccessSubjectAddButton
            selectedGroups={selection.groups}
            selectedMembers={selection.members}
            onChange={onSelectionChange}
          />
        </div>
      </div>
      <div className="px-1 pb-1">
        <AccessSubjectSelectionList
          selectedGroups={selection.groups}
          selectedMembers={selection.members}
          onChange={onSelectionChange}
        />
      </div>
    </div>
  )
}
