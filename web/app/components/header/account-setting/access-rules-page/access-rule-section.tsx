'use client'

import type { AccessPolicyWithBindings } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import AccessRuleRow from './access-rule-row'

type AccessRuleSectionProps = {
  title: string
  rules: AccessPolicyWithBindings[]
  totalCount?: number
  isLoadingRules: boolean
  isFetchingNextPage?: boolean
  hasNextPage?: boolean
  fetchNextPage?: () => unknown
  error?: unknown
  defaultExpanded?: boolean
  onCreate?: () => void
  onViewRule?: (rule: AccessPolicyWithBindings) => void
  onEditRule?: (rule: AccessPolicyWithBindings) => void
  className?: string
}

const AccessRuleSection = ({
  title,
  rules,
  totalCount,
  isLoadingRules,
  isFetchingNextPage = false,
  hasNextPage,
  fetchNextPage,
  error,
  defaultExpanded = false,
  onCreate,
  onViewRule,
  onEditRule,
  className,
}: AccessRuleSectionProps) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const listRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManage = hasPermission(workspacePermissionKeys, 'workspace.role.manage')
  const ruleCount = totalCount ?? rules.length

  useEffect(() => {
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (!expanded || error || !fetchNextPage) return

    if (anchorRef.current && listRef.current) {
      const containerHeight = listRef.current.clientHeight
      const dynamicMargin = Math.max(48, Math.min(containerHeight * 0.2, 120))

      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries[0]!.isIntersecting &&
            !isLoadingRules &&
            !isFetchingNextPage &&
            !error &&
            hasMore
          )
            fetchNextPage()
        },
        {
          root: listRef.current,
          rootMargin: `${dynamicMargin}px`,
        },
      )
      observer.observe(anchorRef.current)
    }

    return () => observer?.disconnect()
  }, [error, expanded, fetchNextPage, hasNextPage, isFetchingNextPage, isLoadingRules])

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      render={
        <section
          className={cn(
            'overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg',
            className,
          )}
        />
      }
    >
      <div className="flex items-center gap-4 p-4">
        <CollapsibleTrigger
          className="min-h-0 w-auto min-w-0 flex-1 justify-start gap-0 rounded-none px-0 hover:not-data-disabled:bg-transparent"
          render={<button type="button" className="min-w-0 flex-1 text-left" />}
        >
          <div className="flex min-w-0 items-center gap-4">
            <span className="truncate system-sm-semibold text-text-primary">{title}</span>
            <span className="shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['accessRule.summary'], { ns: 'permission', count: ruleCount })}
            </span>
          </div>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-3">
          {canManage && (
            <Button variant="primary" size="medium" onClick={onCreate} disabled={isLoadingRules}>
              <span className="i-ri-add-line size-3.5" />
              <span>{t(($) => $['accessRule.newPermissionSet'], { ns: 'permission' })}</span>
            </Button>
          )}
          <CollapsibleTrigger
            className="size-8 min-h-0 justify-center gap-0 p-1.5 hover:not-data-disabled:text-text-secondary data-panel-open:bg-state-accent-active data-panel-open:text-text-accent data-panel-open:hover:bg-state-accent-active-alt"
            render={
              <IconButton
                size="lg"
                aria-label={
                  expanded
                    ? t(($) => $['accessRule.collapseSection'], { ns: 'permission', title })
                    : t(($) => $['accessRule.expandSection'], { ns: 'permission', title })
                }
              >
                <span
                  aria-hidden="true"
                  className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-data-panel-open:rotate-90"
                />
              </IconButton>
            }
          />
        </div>
      </div>
      <CollapsiblePanel
        render={
          <div
            ref={listRef}
            className="max-h-105 overflow-y-auto overscroll-contain border-t border-divider-deep px-4"
          />
        }
      >
        {isLoadingRules ? (
          <div className="px-1 py-8 text-center">
            <Loading type="app" />
          </div>
        ) : rules.length === 0 ? (
          <div className="px-1 py-8 text-center system-sm-regular text-text-tertiary">
            {t(($) => $['accessRule.noRules'], { ns: 'permission' })}
          </div>
        ) : (
          <>
            {rules.map((rule, index) => (
              <AccessRuleRow
                key={rule.policy.id}
                rule={rule}
                canManage={canManage}
                className={cn(index > 0 && 'border-t border-divider-regular')}
                onView={onViewRule}
                onEdit={onEditRule}
              />
            ))}
            <div ref={anchorRef} className="h-1" />
            {isFetchingNextPage && (
              <div className="px-1 py-3 text-center system-xs-regular text-text-tertiary">
                <Loading type="app" />
              </div>
            )}
          </>
        )}
      </CollapsiblePanel>
    </Collapsible>
  )
}

export default memo(AccessRuleSection)
