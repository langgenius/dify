import {
  memo,
  useCallback,
} from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import {
  AuthCategory,
  Authorized,
} from '@/app/components/plugins/plugin-auth'
import Indicator from '@/app/components/header/indicator'
import Badge from '@/app/components/base/badge'

const SwitchCredentialInLoadBalancing = () => {
  const renderTrigger = useCallback(() => {
    return (
      <Button
        variant='secondary'
        className='space-x-1'
      >
        <Indicator />
        chat-enterprise
        <Badge>enterprise</Badge>
        <RiArrowDownSLine className='h-4 w-4' />
      </Button>
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
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -8,
      }}
      renderTrigger={renderTrigger}
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)
