import type { InfiniteData } from '@tanstack/react-query'
import type { AccessPolicyWithBindings } from '@/models/access-control'

const FULL_ACCESS_POLICY_KEYS = new Set(['app.full_access', 'dataset.full_access'])

type AccessRulesResponse = {
  items: AccessPolicyWithBindings[]
}

const isFullAccessPolicy = (policyKey: string) => {
  return FULL_ACCESS_POLICY_KEYS.has(policyKey)
}

export const isProtectedFullAccessOwnerRole = (
  policyKey: string,
  role: AccessPolicyWithBindings['roles'][number],
) => {
  return isFullAccessPolicy(policyKey) && role.role_tag === 'owner'
}

export const getProtectedFullAccessOwnerRoleIds = (rule: AccessPolicyWithBindings) => {
  const { policy, roles } = rule
  return roles
    .filter(role => isProtectedFullAccessOwnerRole(policy.policy_key, role))
    .map(role => role.role_id)
}

export const mergeProtectedRoleIds = (roleIds: string[], protectedRoleIds: string[]) => {
  if (protectedRoleIds.length === 0)
    return roleIds

  return [...new Set([...roleIds, ...protectedRoleIds])]
}

export const updateAccessRulesBindingLockStatus = <TResponse extends AccessRulesResponse>(
  data: InfiniteData<TResponse> | undefined,
  bindingId: string,
  isLocked: boolean,
) => {
  if (!data)
    return data

  let hasUpdates = false
  const pages = data.pages.map((page) => {
    let pageHasUpdates = false
    const items = page.items.map((rule) => {
      let ruleHasUpdates = false
      const roles = rule.roles.map((role) => {
        if (role.binding_id !== bindingId || role.is_locked === isLocked)
          return role

        ruleHasUpdates = true
        return {
          ...role,
          is_locked: isLocked,
        }
      })
      const accounts = rule.accounts.map((account) => {
        if (account.binding_id !== bindingId || account.is_locked === isLocked)
          return account

        ruleHasUpdates = true
        return {
          ...account,
          is_locked: isLocked,
        }
      })

      if (!ruleHasUpdates)
        return rule

      pageHasUpdates = true
      return {
        ...rule,
        roles,
        accounts,
      }
    })

    if (!pageHasUpdates)
      return page

    hasUpdates = true
    return {
      ...page,
      items,
    }
  })

  if (!hasUpdates)
    return data

  return {
    ...data,
    pages,
  }
}
