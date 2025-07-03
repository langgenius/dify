import {
  memo,
  useState,
} from 'react'
import {
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import Badge from '@/app/components/base/badge'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'
import AddOauthButton from './add-oauth-button'
import AddApiKeyButton from './add-api-key-button'

const Authorization = () => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={isOpen}
      onOpenChange={setIsOpen}
      placement='bottom-start'
      offset={8}
      triggerPopupSameWidth
    >
      <PortalToFollowElemTrigger
        onClick={() => setIsOpen(!isOpen)}
        asChild
      >
        <Button
          className={cn(
            'w-full',
            isOpen && 'bg-components-button-secondary-bg-hover',
          )}>
          <Indicator className='mr-2' />
          4 Authorizations
          <RiArrowDownSLine className='ml-0.5 h-4 w-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='max-h-[360px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <div className='py-1'>
            <div className='p-1'>
              <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
                OAuth
              </div>
              <div className='flex items-center rounded-lg p-1 hover:bg-state-base-hover'>
                <div className='flex grow items-center space-x-1.5 pl-2'>
                  <Indicator className='mr-1.5' />
                  <div
                    className='system-md-regular truncate text-text-secondary'
                    title='Auth 1'
                  >
                    Auth 1
                  </div>
                  <Badge>
                    Default
                  </Badge>
                </div>
                <div className='ml-2 flex shrink-0 items-center'>
                  <ActionButton>
                    <RiEditLine className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                  <ActionButton>
                    <RiDeleteBinLine className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </div>
              </div>
            </div>
            <div className='p-1'>
              <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
                API Keys
              </div>
              <div className='flex items-center rounded-lg p-1 hover:bg-state-base-hover'>
                <div className='flex grow items-center space-x-1.5 pl-2'>
                  <Indicator className='mr-1.5' />
                  <div
                    className='system-md-regular truncate text-text-secondary'
                    title='Production'
                  >
                    Production
                  </div>
                </div>
                <div className='ml-2 flex shrink-0 items-center space-x-1'>
                  <Badge>
                    0.2
                  </Badge>
                  <Badge>
                    ENTERPRISE
                  </Badge>
                </div>
              </div>
            </div>
          </div>
          <div className='h-[1px] bg-divider-subtle'></div>
          <div className='flex items-center space-x-1.5 p-2'>
            <AddOauthButton
              buttonVariant='secondary'
              buttonText='Add OAuth'
              className='hover:bg-components-button-secondary-bg'
              buttonLeftClassName='hover:bg-components-button-secondary-bg-hover'
              buttonRightClassName='hover:bg-components-button-secondary-bg-hover'
              dividerClassName='bg-divider-regular opacity-100'
            />
            <AddApiKeyButton
              buttonVariant='secondary'
              buttonText='Add API Key'
            />
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(Authorization)
