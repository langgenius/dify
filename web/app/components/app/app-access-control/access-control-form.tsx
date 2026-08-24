'use client'

import type {
  AccessControlSubjects,
  AccessControlSubjectsStatus,
} from './specific-groups-or-members'
import type { AccessMode } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessMode as AccessModeValue } from '@/models/access-control'
import { Infotip } from '../../base/infotip'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import SpecificGroupsOrMembers, { WebAppSSONotEnabledTip } from './specific-groups-or-members'

export type AccessControlFormProps = {
  accessMode: AccessMode
  subjects: AccessControlSubjects
  subjectsStatus: AccessControlSubjectsStatus
  updatePending: boolean
  publicAccessDisabled: boolean
  externalMembersTipHidden: boolean
  onAccessModeChange: (accessMode: AccessMode) => void
  onSubjectsChange: (subjects: AccessControlSubjects) => void
  onRetrySubjects?: () => void
  onClose: () => void
  onConfirm: () => void
}

export function AccessControlForm({
  accessMode,
  subjects,
  subjectsStatus,
  updatePending,
  publicAccessDisabled,
  externalMembersTipHidden,
  onAccessModeChange,
  onSubjectsChange,
  onRetrySubjects,
  onClose,
  onConfirm,
}: AccessControlFormProps) {
  const accessControlOptionsLabelId = useId()
  const { t } = useTranslation()
  const confirmDisabled =
    updatePending ||
    (accessMode === AccessModeValue.PUBLIC && publicAccessDisabled) ||
    (accessMode === AccessModeValue.SPECIFIC_GROUPS_MEMBERS && subjectsStatus !== 'success')

  return (
    <AccessControlDialog show onClose={onClose}>
      <div className="flex flex-col gap-y-3">
        <div className="pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['accessControlDialog.title'], { ns: 'app' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['accessControlDialog.description'], { ns: 'app' })}
          </DialogDescription>
        </div>
        <RadioGroup<AccessMode>
          value={accessMode}
          onValueChange={onAccessModeChange}
          className="flex flex-col items-stretch gap-y-1 px-6 pb-3"
          aria-labelledby={accessControlOptionsLabelId}
        >
          <div className="leading-6">
            <p id={accessControlOptionsLabelId} className="system-sm-medium text-text-tertiary">
              {t(($) => $['accessControlDialog.accessLabel'], { ns: 'app' })}
            </p>
          </div>
          <AccessControlItem type={AccessModeValue.ORGANIZATION}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <span aria-hidden="true" className="i-ri-building-line size-4 text-text-primary" />
                <p className="system-sm-medium text-text-primary">
                  {t(($) => $['accessControlDialog.accessItems.organization'], { ns: 'app' })}
                </p>
              </div>
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessModeValue.SPECIFIC_GROUPS_MEMBERS}>
            <SpecificGroupsOrMembers
              accessMode={accessMode}
              subjects={subjects}
              subjectsStatus={subjectsStatus}
              onSubjectsChange={onSubjectsChange}
              onRetrySubjects={onRetrySubjects}
            />
          </AccessControlItem>
          <AccessControlItem type={AccessModeValue.EXTERNAL_MEMBERS}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <span
                  aria-hidden="true"
                  className="i-ri-verified-badge-line size-4 text-text-primary"
                />
                <p className="system-sm-medium text-text-primary">
                  {t(($) => $['accessControlDialog.accessItems.external'], { ns: 'app' })}
                </p>
              </div>
              {!externalMembersTipHidden && <WebAppSSONotEnabledTip />}
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessModeValue.PUBLIC} disabled={publicAccessDisabled}>
            <div className="flex items-center gap-x-2 p-3">
              <span aria-hidden="true" className="i-ri-global-line size-4 text-text-primary" />
              <p className="system-sm-medium text-text-primary">
                {t(($) => $['accessControlDialog.accessItems.anyone'], { ns: 'app' })}
              </p>
              {publicAccessDisabled && (
                <Infotip
                  aria-label={t(($) => $['accessControlDialog.webAppPublicAccessDisabledTip'], {
                    ns: 'app',
                  })}
                  className="h-4 w-4 shrink-0 text-text-warning-secondary hover:text-text-warning-secondary"
                >
                  {t(($) => $['accessControlDialog.webAppPublicAccessDisabledTip'], {
                    ns: 'app',
                  })}
                </Infotip>
              )}
            </div>
          </AccessControlItem>
        </RadioGroup>
        <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
          <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button
            disabled={confirmDisabled}
            loading={updatePending}
            variant="primary"
            onClick={onConfirm}
          >
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </Button>
        </div>
      </div>
    </AccessControlDialog>
  )
}
