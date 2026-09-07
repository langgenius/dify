import type { ReactNode } from 'react'

type ImportWarning = {
  message: string
}

type DSLImportWarningDescriptionProps = {
  warnings?: ImportWarning[]
  fallback: ReactNode
}

const MAX_VISIBLE_IMPORT_WARNINGS = 3

const DSLImportWarningDescription = ({
  warnings = [],
  fallback,
}: DSLImportWarningDescriptionProps) => {
  const messages = [...new Set(warnings.map((warning) => warning.message.trim()).filter(Boolean))]

  if (!messages.length) return fallback

  const visibleWarnings = messages.slice(0, MAX_VISIBLE_IMPORT_WARNINGS).map((message) => ({
    id: `warning:${message}`,
    message,
  }))
  if (messages.length > MAX_VISIBLE_IMPORT_WARNINGS)
    visibleWarnings.push({ id: 'overflow', message: '…' })

  return (
    <span role="list" className="block">
      {visibleWarnings.map((warning) => (
        <span key={warning.id} role="listitem" className="block">
          {warning.message}
        </span>
      ))}
    </span>
  )
}

export default DSLImportWarningDescription
