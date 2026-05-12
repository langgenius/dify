import type { Credential } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import {
  RiAddLine,
  RiArrowDownSLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Indicator from '@/app/components/header/indicator'
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleSelect = useCallback((credential: Credential & { addNewCredential?: boolean }) => {
    setOpen(false)
    onSelect(credential)
  }, [onSelect])
  const handleAddNewCredential = useCallback(() => {
    handleSelect({
      credential_id: '__add_new_credential',
      addNewCredential: true,
      credential_name: t('modelProvider.auth.addNewModelCredential', { ns: 'common' }),
    })
  }, [handleSelect, t])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        nativeButton={false}
        disabled={disabled}
        render={<div className="flex h-8 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-2 system-sm-regular" />}
      >
        {
          selectedCredential && (
            <div className="flex items-center">
              {
                !selectedCredential.addNewCredential && <Indicator className="mr-2 ml-1 shrink-0" />
              }
              <div className="truncate system-sm-regular text-components-input-text-filled" title={selectedCredential.credential_name}>{selectedCredential.credential_name}</div>
              {
                selectedCredential.from_enterprise && (
                  <Badge className="shrink-0">Enterprise</Badge>
                )
              }
            </div>
          )
        }
        {
          !selectedCredential && (
            <div className="grow truncate system-sm-regular text-components-input-text-placeholder">{t('modelProvider.auth.selectModelCredential', { ns: 'common' })}</div>
          )
        }
        <RiArrowDownSLine className="h-4 w-4 text-text-quaternary" />
      </PopoverTrigger>
      <PopoverContent
        sideOffset={0}
        popupClassName="border-ccomponents-panel-border rounded-xl border-[0.5px] bg-components-panel-bg-blur p-0"
        popupProps={{ style: { width: 'var(--anchor-width, auto)' } }}
      >
        <div className="max-h-[320px] overflow-y-auto p-1">
          {
            credentials.map(credential => (
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
            ))
          }
        </div>
        {
          !notAllowAddNewCredential && (
            <div
              className="flex h-10 cursor-pointer items-center border-t border-t-divider-subtle px-7 system-xs-medium text-text-accent-light-mode-only"
              onClick={handleAddNewCredential}
            >
              <RiAddLine className="mr-1 h-4 w-4" />
              {t('modelProvider.auth.addNewModelCredential', { ns: 'common' })}
            </div>
          )
        }
      </PopoverContent>
    </Popover>
  )
}

export default memo(CredentialSelector)
