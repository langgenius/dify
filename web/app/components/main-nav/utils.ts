export const getWorkspaceInitial = (name?: string) => name?.[0]?.toLocaleUpperCase() || '?'

export const getRemainingCredits = (total: number, used: number) => Math.max(total - used, 0)

export const formatCredits = (value: number) => new Intl.NumberFormat().format(value)
