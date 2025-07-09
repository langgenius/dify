import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'
import type { Credential } from './types'
import {
  Authorized,
  usePluginAuth,
} from '.'

type AuthorizedInNodeProps = {
  provider: string
  onAuthorizationItemClick: (id: string) => void
  credentialId?: string
}
const AuthorizedInNode = ({
  provider = '',
  onAuthorizationItemClick,
  credentialId,
}: AuthorizedInNodeProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const {
    canApiKey,
    canOAuth,
    credentials,
    disabled,
  } = usePluginAuth(provider, isOpen)
  const label = useMemo(() => {
    if (!credentialId)
      return 'Workspace default'
    const credential = credentials.find(c => c.id === credentialId)

    if (!credential)
      return 'Auth removed'

    return credential.name
  }, [credentials, credentialId])
  const renderTrigger = useCallback((open?: boolean) => {
    return (
      <Button
        size='small'
        className={cn(open && 'bg-components-button-ghost-bg-hover')}
      >
        <Indicator className='mr-1.5' />
        {label}
        <RiArrowDownSLine className='h-3.5 w-3.5 text-components-button-ghost-text' />
      </Button>
    )
  }, [label])
  const extraAuthorizationItems: Credential[] = [
    {
      id: '__workspace_default__',
      name: 'Workspace default',
      provider: '',
      is_default: false,
      isWorkspaceDefault: true,
    },
  ]
  const handleAuthorizationItemClick = useCallback((id: string) => {
    onAuthorizationItemClick(id)
    setIsOpen(false)
  }, [
    onAuthorizationItemClick,
    setIsOpen,
  ])

  return (
    <Authorized
      provider={provider}
      credentials={credentials}
      canOAuth={canOAuth}
      canApiKey={canApiKey}
      renderTrigger={renderTrigger}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      offset={4}
      placement='bottom-end'
      triggerPopupSameWidth={false}
      popupClassName='w-[360px]'
      disabled={disabled}
      disableSetDefault
      onItemClick={handleAuthorizationItemClick}
      extraAuthorizationItems={extraAuthorizationItems}
    />
  )
}

export default memo(AuthorizedInNode)
