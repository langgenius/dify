import type { DslImportWarning } from '@dify/contracts/api/console/apps/types.gen'

const MAX_VISIBLE_IMPORT_WARNINGS = 3

export const getDSLImportWarningDescription = (warnings: DslImportWarning[] = []) => {
  const messages = [...new Set(warnings.map((warning) => warning.message.trim()).filter(Boolean))]
  if (!messages.length) return

  const visibleMessages = messages.slice(0, MAX_VISIBLE_IMPORT_WARNINGS)
  if (messages.length > MAX_VISIBLE_IMPORT_WARNINGS) visibleMessages.push('…')
  return visibleMessages.join(' · ')
}
