'use client'

import type { ReactNode } from 'react'
import type { SpecificGroupsOrMembersProps } from './specific-groups-or-members'
import { Button } from '@langgenius/dify-ui/button'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { AccessControlItem } from './access-control-item'
import { SpecificGroupsOrMembers, WebAppSSONotEnabledTip } from './specific-groups-or-members'

type AccessControlDialogContentProps = {
  title?: ReactNode
  description?: ReactNode
  accessLabel?: ReactNode
  hideExternal?: boolean
  hideExternalTip?: boolean
  saving?: boolean
  confirmDisabled?: boolean
  specificGroupsOrMembersProps?: SpecificGroupsOrMembersProps
  onClose: () => void
  onConfirm: () => void
}

export function AccessControlDialogContent({
  title,
  description,
  accessLabel,
  hideExternal = false,
  hideExternalTip = false,
  saving = false,
  confirmDisabled = false,
  specificGroupsOrMembersProps,
  onClose,
  onConfirm,
}: AccessControlDialogContentProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-y-3">
      <div className="pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {title ?? t('accessControlDialog.title', { ns: 'app' })}
        </DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {description ?? t('accessControlDialog.description', { ns: 'app' })}
        </DialogDescription>
      </div>
      <div className="flex flex-col gap-y-1 px-6 pb-3">
        <div className="leading-6">
          <p className="system-sm-medium text-text-tertiary">
            {accessLabel ?? t('accessControlDialog.accessLabel', { ns: 'app' })}
          </p>
        </div>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <div className="flex items-center p-3">
            <div className="flex grow items-center gap-x-2">
              <span className="i-ri-building-line size-4 text-text-primary" aria-hidden="true" />
              <p className="system-sm-medium text-text-primary">
                {t('accessControlDialog.accessItems.organization', { ns: 'app' })}
              </p>
            </div>
          </div>
        </AccessControlItem>
        <AccessControlItem type={AccessMode.SPECIFIC_GROUPS_MEMBERS}>
          <SpecificGroupsOrMembers {...specificGroupsOrMembersProps} />
        </AccessControlItem>
        {!hideExternal && (
          <AccessControlItem type={AccessMode.EXTERNAL_MEMBERS}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <span className="i-ri-verified-badge-line size-4 text-text-primary" aria-hidden="true" />
                <p className="system-sm-medium text-text-primary">
                  {t('accessControlDialog.accessItems.external', { ns: 'app' })}
                </p>
              </div>
              {!hideExternalTip && <WebAppSSONotEnabledTip />}
            </div>
          </AccessControlItem>
        )}
        <AccessControlItem type={AccessMode.PUBLIC}>
          <div className="flex items-center gap-x-2 p-3">
            <span className="i-ri-global-line size-4 text-text-primary" aria-hidden="true" />
            <p className="system-sm-medium text-text-primary">
              {t('accessControlDialog.accessItems.anyone', { ns: 'app' })}
            </p>
          </div>
        </AccessControlItem>
      </div>
      <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
        <Button disabled={saving} onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button disabled={confirmDisabled || saving} loading={saving} variant="primary" onClick={onConfirm}>
          {t('operation.confirm', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
