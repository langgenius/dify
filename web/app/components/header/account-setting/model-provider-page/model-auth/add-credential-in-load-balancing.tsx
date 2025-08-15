import {
  memo,
  useCallback,
} from 'react'
import { RiAddLine } from '@remixicon/react'
import { Authorized } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import cn from '@/utils/classnames'
import type {
  Credential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'

type AddCredentialInLoadBalancingProps = {
  provider: ModelProvider
  onSetup: (credential?: Credential) => void
}
const AddCredentialInLoadBalancing = ({
  provider,
  onSetup,
}: AddCredentialInLoadBalancingProps) => {
  const renderTrigger = useCallback((open?: boolean) => {
    return (
      <div className={cn(
        'flex h-8 items-center rounded-lg px-3 hover:bg-state-base-hover',
        open && 'bg-state-base-hover',
      )}>
        <RiAddLine className='system-sm-medium h-4 w-4 text-text-accent' />
        Add credential
      </div>
    )
  }, [])

  return (
    <Authorized
      credentials={[]}
      provider={provider.provider}
      renderTrigger={renderTrigger}
      onSetup={onSetup}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)
