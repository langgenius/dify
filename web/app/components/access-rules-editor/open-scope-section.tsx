'use client'

import type { ResourceOpenScope } from '@/models/access-control'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OpenScopeConfirmDialog from './open-scope-confirm-dialog'
import OpenScopeOption from './open-scope-option'

type ResourceOpenScopeSectionProps = {
  value: ResourceOpenScope
  disabled: boolean
  onChange?: (openScope: ResourceOpenScope) => void
}

export default function ResourceOpenScopeSection({
  value,
  disabled,
  onChange,
}: ResourceOpenScopeSectionProps) {
  const { t } = useTranslation()
  const [pendingOpenScope, setPendingOpenScope] = useState<ResourceOpenScope | null>(null)

  const handleRequestChange = (nextOpenScope: ResourceOpenScope) => {
    if (nextOpenScope === value)
      return

    setPendingOpenScope(nextOpenScope)
  }

  const handleCancelChange = () => {
    setPendingOpenScope(null)
  }

  const handleConfirmChange = () => {
    if (!pendingOpenScope)
      return

    onChange?.(pendingOpenScope)
    setPendingOpenScope(null)
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="system-sm-semibold text-text-secondary">
        {t('accessRule.resourceOpenScope', { ns: 'permission' })}
      </h2>
      <p className="system-xs-regular text-text-tertiary">
        {t('accessRule.resourceOpenScopeDescription', { ns: 'permission' })}
      </p>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <OpenScopeOption
          value="all"
          selected={value === 'all'}
          disabled={disabled || !onChange}
          title={t('accessRule.allPermittedMembers', { ns: 'permission' })}
          description={t('accessRule.allPermittedMembersDescription', { ns: 'permission' })}
          onChange={onChange ? handleRequestChange : undefined}
        />
        <OpenScopeOption
          value="specific"
          selected={value === 'specific'}
          disabled={disabled || !onChange}
          title={t('accessRule.specificMembersOnly', { ns: 'permission' })}
          description={t('accessRule.specificMembersOnlyDescription', { ns: 'permission' })}
          onChange={onChange ? handleRequestChange : undefined}
        />
      </div>
      <OpenScopeConfirmDialog
        open={!!pendingOpenScope}
        onCancel={handleCancelChange}
        onConfirm={handleConfirmChange}
      />
    </section>
  )
}
