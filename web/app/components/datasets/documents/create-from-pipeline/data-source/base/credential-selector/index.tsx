import type { DataSourceCredential } from '@/types/pipeline'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import List from './list'
import Trigger from './trigger'

export type CredentialSelectorProps = {
  currentCredentialId: string
  onCredentialChange: (credentialId: string) => void
  credentials: Array<DataSourceCredential>
}

const CredentialSelector = ({
  currentCredentialId,
  onCredentialChange,
  credentials,
}: CredentialSelectorProps) => {
  const [open, { set, setFalse }] = useBoolean(false)

  const currentCredential = useMemo(() => {
    return credentials.find(cred => cred.id === currentCredentialId)
  }, [credentials, currentCredentialId])

  useEffect(() => {
    if (!currentCredential && credentials.length)
      onCredentialChange(credentials[0]!.id)
  }, [currentCredential, credentials])

  const handleCredentialChange = useCallback((credentialId: string) => {
    onCredentialChange(credentialId)
    setFalse()
  }, [onCredentialChange, setFalse])

  return (
    <Popover
      open={open}
      onOpenChange={set}
    >
      <PopoverTrigger
        nativeButton={false}
        render={<div className="grow overflow-hidden" />}
      >
        <Trigger
          currentCredential={currentCredential}
          isOpen={open}
        />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <List
          currentCredentialId={currentCredentialId}
          credentials={credentials}
          onCredentialChange={handleCredentialChange}
        />
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(CredentialSelector)
