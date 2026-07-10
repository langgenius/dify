'use client'

import type {
  AccessPermissionKind,
  SelectableAccessSubject,
} from './access-policy'
import { AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  permissionIcon,
} from './access-policy'

export function PermissionSummaryButton({
  value,
  subjects,
  disabled,
  loading,
  environmentLabel,
  onClick,
}: {
  value: AccessPermissionKind
  subjects?: SelectableAccessSubject[]
  disabled?: boolean
  loading?: boolean
  environmentLabel: string
  onClick: () => void
}) {
  const { t } = useTranslation('deployments')
  const groupCount = subjects?.filter(subject => subject.subjectType === AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP).length ?? 0
  const memberCount = (subjects?.length ?? 0) - groupCount
  const countLabels = [
    ...(groupCount > 0 ? [t($ => $['access.members.groupCount'], { count: groupCount })] : []),
    ...(memberCount > 0 ? [t($ => $['access.members.memberCount'], { count: memberCount })] : []),
  ]
  const specificSubjectLabel = value === 'specific'
    ? subjects && subjects.length > 0
      ? countLabels.join(' · ')
      : t($ => $['access.permission.specificDesc'])
    : undefined
  const IconClassName = loading ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none' : permissionIcon[value]

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t($ => $['access.permissions.editAriaLabel'], { environment: environmentLabel })}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full min-w-0 cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5 outline-hidden hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-active',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-components-input-bg-normal',
      )}
    >
      <div className="flex min-w-0 grow items-center gap-x-1.5 pr-1">
        <span
          className={cn(IconClassName, 'size-4 shrink-0 text-text-secondary')}
          aria-hidden="true"
        />
        <p className="min-w-0 truncate text-left system-sm-medium text-text-secondary">
          {t($ => $[`access.permission.${value}`])}
        </p>
      </div>
      {specificSubjectLabel && (
        <p className="shrink-0 system-xs-regular text-text-tertiary">
          {specificSubjectLabel}
        </p>
      )}
      <div className="flex size-4 shrink-0 items-center justify-center">
        <span className="i-ri-arrow-right-s-line size-4 text-text-quaternary" aria-hidden="true" />
      </div>
    </button>
  )
}
