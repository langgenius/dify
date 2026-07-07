'use client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { CredentialIcon } from '@/app/components/datasets/common/credential-icon'

export type NotionCredential = {
  credentialId: string
  credentialName: string
  workspaceIcon?: string
  workspaceName?: string
}

type CredentialSelectorProps = {
  value: string
  items: NotionCredential[]
  onSelect: (v: string) => void
}

const getDisplayName = (item?: NotionCredential) => {
  return item?.workspaceName || item?.credentialName || ''
}

const CredentialSelector = ({
  value,
  items,
  onSelect,
}: CredentialSelectorProps) => {
  const currentCredential = items.find(item => item.credentialId === value) ?? items[0]
  const currentDisplayName = getDisplayName(currentCredential)

  return (
    <Select value={currentCredential?.credentialId ?? null} onValueChange={nextValue => nextValue && onSelect(nextValue)}>
      <SelectTrigger
        aria-label={currentDisplayName}
        className="w-[168px]"
      >
        <span className="flex min-w-0 items-center">
          <CredentialIcon
            className="mr-2 shrink-0"
            avatarUrl={currentCredential?.workspaceIcon}
            name={currentDisplayName}
            size={20}
          />
          <span
            className="truncate"
            title={currentDisplayName}
            data-testid="notion-credential-selector-name"
          >
            {currentDisplayName}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent popupClassName="w-80" listClassName="max-h-50">
        {items.map((item) => {
          const displayName = getDisplayName(item)
          return (
            <SelectItem
              key={item.credentialId}
              value={item.credentialId}
              className="h-9 px-3"
              data-testid={`notion-credential-item-${item.credentialId}`}
            >
              <CredentialIcon
                className="mr-2 shrink-0"
                avatarUrl={item.workspaceIcon}
                name={displayName}
                size={20}
              />
              <SelectItemText title={displayName}>
                {displayName}
              </SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export default CredentialSelector
