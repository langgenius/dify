import type { Credential } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CredentialItem from './authorized/credential-item'

type CredentialSelectorProps = {
  selectedCredential?: Credential & { addNewCredential?: boolean }
  credentials: Credential[]
  onSelect: (credential: Credential & { addNewCredential?: boolean }) => void
  disabled?: boolean
  notAllowAddNewCredential?: boolean
}
const CredentialSelector = ({
  selectedCredential,
  credentials,
  onSelect,
  disabled,
  notAllowAddNewCredential,
}: CredentialSelectorProps) => {
  const { t } = useTranslation(['common', 'modelProvider'])
  const [open, setOpen] = useState(false)
  const handleSelect = useCallback(
    (credential: Credential & { addNewCredential?: boolean }) => {
      setOpen(false)
      onSelect(credential)
    },
    [onSelect],
  )
  const handleAddNewCredential = useCallback(() => {
    handleSelect({
      credential_id: '__add_new_credential',
      addNewCredential: true,
      credential_name: t(($) => $['modelProvider.auth.addNewModelCredential'], {
        ns: 'modelProvider',
      }),
    })
  }, [handleSelect, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="flex h-8 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-2 text-left system-sm-regular focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
          />
        }
      >
        {selectedCredential && (
          <span className="flex items-center">
            {!selectedCredential.addNewCredential && <StatusDot className="mr-2 ml-1 shrink-0" />}
            <span
              className="truncate system-sm-regular text-components-input-text-filled"
              title={selectedCredential.credential_name}
            >
              {selectedCredential.credential_name}
            </span>
            {selectedCredential.from_enterprise && (
              <span className="badge badge-m shrink-0 px-1.25 py-0.5 system-2xs-medium">
                Enterprise
              </span>
            )}
          </span>
        )}
        {!selectedCredential && (
          <span className="grow truncate system-sm-regular text-components-input-text-placeholder">
            {t(($) => $['modelProvider.auth.selectModelCredential'], { ns: 'modelProvider' })}
          </span>
        )}
        <RiArrowDownSLine className="size-4 text-text-quaternary" />
      </PopoverTrigger>
      <PopoverContent
        sideOffset={0}
        className="w-(--anchor-width) rounded-xl border-[0.5px] border-current bg-components-panel-bg-blur p-0"
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['modelProvider.auth.selectModelCredential'], { ns: 'modelProvider' })}
        </PopoverTitle>
        <div className="max-h-80 overflow-y-auto p-1">
          {credentials.map((credential) => (
            <CredentialItem
              key={credential.credential_id}
              credential={credential}
              disableDelete
              disableEdit
              disableRename
              onItemClick={handleSelect}
              showSelectedIcon
              selectedCredentialId={selectedCredential?.credential_id}
            />
          ))}
        </div>
        {!notAllowAddNewCredential && (
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center border-t border-t-divider-subtle px-7 text-left system-xs-medium text-text-accent-light-mode-only focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
            onClick={handleAddNewCredential}
          >
            <RiAddLine className="mr-1 size-4" />
            {t(($) => $['modelProvider.auth.addNewModelCredential'], { ns: 'modelProvider' })}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(CredentialSelector)
