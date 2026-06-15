'use client'

import type { AccessPolicyWithBindings } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'

export type AccessRulesEditorProps = {
  rules: AccessPolicyWithBindings[]
  isLoadingRules?: boolean
  title?: string
  className?: string
}

const AccessRulesEditor = ({
  rules,
  isLoadingRules = false,
  title,
  className,
}: AccessRulesEditorProps) => {
  const { t } = useTranslation()
  const permissionSetCount = rules.length
  const lockedCount = useMemo(() => {
    let lockedCount = 0
    rules.forEach((rule) => {
      rule.roles.forEach((role) => {
        if (role.is_locked)
          lockedCount += 1
      })
      rule.accounts.forEach((account) => {
        if (account.is_locked)
          lockedCount += 1
      })
    })
    return lockedCount
  }, [rules])

  return (
    <div className={cn('overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg', className)}>
      <div className="flex min-h-12 items-center gap-3 border-b border-divider-deep p-4">
        <h2 className="min-w-0 truncate system-sm-semibold text-text-primary">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1 system-xs-regular text-text-tertiary">
          <span>
            {t('accessRule.summary', { ns: 'permission', count: permissionSetCount })}
          </span>
          {lockedCount > 0 && (
            <span>
              {t('accessRule.lockedSummary', { ns: 'permission', count: lockedCount })}
            </span>
          )}
        </div>
      </div>

      {isLoadingRules
        ? (
            <div className="px-4 py-8 text-center">
              <Loading type="app" />
            </div>
          )
        : rules.length === 0
          ? (
              <div className="px-4 py-8 text-center system-sm-regular text-text-tertiary">
                {t('accessRule.noRules', { ns: 'permission' })}
              </div>
            )
          : (
              <div className="px-4">
                {
                  rules.map((rule, index) => (
                    <div
                      key={rule.policy.id}
                      className={cn(index > 0 && 'border-t border-divider-subtle')}
                    >
                      <div className="px-1 py-3.5">
                        <div className="flex h-6 items-center system-sm-semibold text-text-primary">
                          {rule.policy.name}
                        </div>
                        <p className="system-xs-regular leading-4 text-text-tertiary">
                          {rule.policy.description}
                        </p>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
    </div>
  )
}

export default AccessRulesEditor
