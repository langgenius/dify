import {
  memo,
  useCallback,
} from 'react'
import { RiAddLine } from '@remixicon/react'
import {
  AuthCategory,
  Authorized,
} from '@/app/components/plugins/plugin-auth'
import cn from '@/utils/classnames'

const AddCredentialInLoadBalancing = () => {
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
      pluginPayload={{
        provider: '',
        category: AuthCategory.model,
      }}
      canApiKey
      offset={4}
      renderTrigger={renderTrigger}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)
