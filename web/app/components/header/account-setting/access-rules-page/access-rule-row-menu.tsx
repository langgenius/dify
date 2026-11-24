'use client'

import type { AccessPolicy } from '@dify/contracts/api/console/workspaces/types.gen'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type AccessRuleRowMenuProps = {
  rule: AccessPolicy
  onView?: () => void
  onEdit?: () => void
  onDelete: (rule: AccessPolicy) => void
}

const AccessRuleRowMenu = ({ rule, onView, onEdit, onDelete }: AccessRuleRowMenuProps) => {
  const { t } = useTranslation(['common', 'permission'])

  const { mutate: copyAccessRule } = useMutation(
    consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.copy.post.mutationOptions(),
  )
  const handleView = useCallback(() => {
    onView?.()
  }, [onView])

  const handleCopyRules = useCallback(() => {
    copyAccessRule(
      { params: { policy_id: rule.id } },
      {
        onSuccess: () => {
          toast.success(t(($) => $['accessRule.copied'], { ns: 'permission' }))
        },
      },
    )
  }, [copyAccessRule, rule.id, t])

  const isBuiltIn = rule.is_builtin

  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            size="lg"
            aria-label={t(($) => $['operation.moreActions'], { ns: 'common' })}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
          </IconButton>
        }
      />
      <MenuContent align="end" className="min-w-35">
        {isBuiltIn ? (
          <MenuItem className="system-sm-semibold text-text-secondary" onClick={handleView}>
            {t(($) => $['operation.view'], { ns: 'common' })}
          </MenuItem>
        ) : (
          <MenuItem className="system-sm-semibold text-text-secondary" onClick={onEdit}>
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </MenuItem>
        )}
        <MenuItem className="system-sm-semibold text-text-secondary" onClick={handleCopyRules}>
          {t(($) => $['common.duplicateAction'], { ns: 'permission' })}
        </MenuItem>
        {!isBuiltIn && (
          <>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              className="system-sm-semibold"
              onClick={() => onDelete(rule)}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}

export default AccessRuleRowMenu
