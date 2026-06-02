import type { InfiniteData } from '@tanstack/react-query'
import type { AccessPolicyWithBindings } from '@/models/access-control'

type AccessRulesResponse = {
  items: AccessPolicyWithBindings[]
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
