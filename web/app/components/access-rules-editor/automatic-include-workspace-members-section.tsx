'use client'

import { Switch } from '@langgenius/dify-ui/switch'
import { memo, useId } from 'react'
import { useTranslation } from 'react-i18next'

type AutomaticIncludeWorkspaceMembersSectionProps = {
  checked?: boolean
  loading: boolean
  onChange?: (checked: boolean) => void
}

function AutomaticIncludeWorkspaceMembersSection({
  checked,
  loading,
  onChange,
}: AutomaticIncludeWorkspaceMembersSectionProps) {
  const { t } = useTranslation()
  const labelId = useId()
  const descriptionId = useId()

  return (
    <section className="flex min-h-21 items-center gap-4 rounded-xl border border-components-panel-border bg-background-default-subtle p-4">
      <div className="min-w-0 flex-1">
        <h2 id={labelId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['accessRule.automaticallyIncludeWorkspaceMembers'], {
            ns: 'permission',
          })}
        </h2>
        <p id={descriptionId} className="mt-0.5 system-xs-regular text-text-tertiary">
          {t(($) => $['accessRule.automaticallyIncludeWorkspaceMembersDescription'], {
            ns: 'permission',
          })}
        </p>
      </div>
      <Switch
        size="lg"
        checked={checked ?? false}
        disabled={checked === undefined || !onChange}
        loading={loading}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onCheckedChange={onChange}
      />
    </section>
  )
}

export default memo(AutomaticIncludeWorkspaceMembersSection)
