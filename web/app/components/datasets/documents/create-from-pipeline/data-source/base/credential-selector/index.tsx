import React, { useCallback, useEffect, useMemo } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { DataSourceCredential } from '@/types/pipeline'
import { useBoolean } from 'ahooks'
import Trigger from './trigger'
import List from './list'

export type CredentialSelectorProps = {
  pluginName: string
  currentCredentialId: string
  onCredentialChange: (credentialId: string) => void
  credentials: Array<DataSourceCredential>
}

const CredentialSelector = ({
  pluginName,
  currentCredentialId,
  onCredentialChange,
  credentials,
}: CredentialSelectorProps) => {
  const [open, { toggle }] = useBoolean(false)

  const currentCredential = useMemo(() => {
    return credentials.find(cred => cred.id === currentCredentialId)
  }, [credentials, currentCredentialId])

  useEffect(() => {
    if (!currentCredential && credentials.length)
      onCredentialChange(credentials[0].id)
  }, [currentCredential, credentials])

  const handleCredentialChange = useCallback((credentialId: string) => {
    onCredentialChange(credentialId)
    toggle()
  }, [onCredentialChange, toggle])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={toggle}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={toggle} className='grow overflow-hidden'>
        <Trigger
          currentCredential={currentCredential}
          pluginName={pluginName}
          isOpen={open}
        />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <List
          currentCredentialId={currentCredentialId}
          credentials={credentials}
          pluginName={pluginName}
          onCredentialChange={handleCredentialChange}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(CredentialSelector)
