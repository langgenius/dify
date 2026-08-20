type Role = { readonly id: string; readonly name: string }

export function formatRoles(roles: readonly Role[]): string {
  return roles.map((role) => role.name || role.id).join(', ')
}
