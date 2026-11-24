import { atom } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

export const canManageContactsAtom = atom((get) =>
  hasPermission(get(workspacePermissionKeysAtom), 'contact.manage'),
)

export const canViewContactsAtom = atom(
  (get) =>
    get(canManageContactsAtom) || hasPermission(get(workspacePermissionKeysAtom), 'contact.view'),
)
