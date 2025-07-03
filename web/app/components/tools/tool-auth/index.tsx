import {
  memo,
} from 'react'
import AddOAuthButton from './add-oauth-button'
import AddApiKeyButton from './add-api-key-button'

const ToolAuth = () => {
  return (
    <>
      <div className='flex items-center space-x-1.5'>
        <AddOAuthButton />
        <div className='system-2xs-medium-uppercase flex shrink-0 flex-col items-center justify-between text-text-tertiary'>
          <div className='h-2 w-[1px] bg-divider-subtle'></div>
          or
          <div className='h-2 w-[1px] bg-divider-subtle'></div>
        </div>
        <AddApiKeyButton />
      </div>
    </>
  )
}

export default memo(ToolAuth)
