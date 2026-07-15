import type { DSLImportWarning } from '@/models/app'

const MAX_VISIBLE_IMPORT_WARNINGS = 3

export const getDSLImportWarningDescription = (warnings: DSLImportWarning[] = []) => {
  const messages = [...new Set(warnings.map((warning) => warning.message.trim()).filter(Boolean))]
  if (!messages.length) return

  const visibleMessages = messages.slice(0, MAX_VISIBLE_IMPORT_WARNINGS)
  if (messages.length > MAX_VISIBLE_IMPORT_WARNINGS) visibleMessages.push('…')
  return visibleMessages.join(' · ')
}
