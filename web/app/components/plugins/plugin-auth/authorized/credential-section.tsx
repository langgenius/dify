import type { Credential } from '../types'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import Item from './item'

type CredentialItemHandlers = {
  onDelete?: (id: string) => void
  onEdit?: (id: string, values: Record<string, unknown>) => void
  onSetDefault?: (id: string) => void
  onRename?: (payload: { credential_id: string, name: string }) => void
  onItemClick?: (id: string) => void
}

type CredentialSectionProps = CredentialItemHandlers & {
  title: string
  credentials: Credential[]
  disabled?: boolean
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  disableSetDefault?: boolean
  showSelectedIcon?: boolean
  selectedCredentialId?: string
}

/**
 * Reusable component for rendering a section of credentials
 * Used for OAuth, API Key, and extra authorization items
 */
const CredentialSection = ({
  title,
  credentials,
  disabled,
  disableRename,
  disableEdit,
  disableDelete,
  disableSetDefault,
  showSelectedIcon,
  selectedCredentialId,
  onDelete,
  onEdit,
  onSetDefault,
  onRename,
  onItemClick,
}: CredentialSectionProps) => {
  if (!credentials.length)
    return null

  return (
    <div className="p-1">
      <div className={cn(
        'system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary',
        showSelectedIcon && 'pl-7',
      )}
      >
        {title}
      </div>
      {credentials.map(credential => (
        <Item
          key={credential.id}
          credential={credential}
          disabled={disabled}
          disableRename={disableRename}
          disableEdit={disableEdit}
          disableDelete={disableDelete}
          disableSetDefault={disableSetDefault}
          showSelectedIcon={showSelectedIcon}
          selectedCredentialId={selectedCredentialId}
          onDelete={onDelete}
          onEdit={onEdit}
          onSetDefault={onSetDefault}
          onRename={onRename}
          onItemClick={onItemClick}
        />
      ))}
    </div>
  )
}

export default memo(CredentialSection)

type ExtraCredentialSectionProps = {
  credentials?: Credential[]
  disabled?: boolean
  onItemClick?: (id: string) => void
  showSelectedIcon?: boolean
  selectedCredentialId?: string
}

/**
 * Specialized section for extra authorization items (read-only)
 */
export const ExtraCredentialSection = memo(({
  credentials,
  disabled,
  onItemClick,
  showSelectedIcon,
  selectedCredentialId,
}: ExtraCredentialSectionProps) => {
  if (!credentials?.length)
    return null

  return (
    <div className="p-1">
      {credentials.map(credential => (
        <Item
          key={credential.id}
          credential={credential}
          disabled={disabled}
          onItemClick={onItemClick}
          disableRename
          disableEdit
          disableDelete
          disableSetDefault
          showSelectedIcon={showSelectedIcon}
          selectedCredentialId={selectedCredentialId}
        />
      ))}
    </div>
  )
})

ExtraCredentialSection.displayName = 'ExtraCredentialSection'
