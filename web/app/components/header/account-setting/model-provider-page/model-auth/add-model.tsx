import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddCircleFill,
  RiAddLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'

const AddModel = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger>
        <Button
          variant='ghost-accent'
          size='small'
        >
          <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
          {t('common.modelProvider.addModel')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <div className='p-1'>
            <div className='flex h-9 items-center'>
              <div className='h-5 w-5 shrink-0'></div>
              <div
                className='system-md-medium mx-1 truncate text-text-primary'
                title='chat-finetune-01'
              >
                chat-finetune-01
              </div>
              <Tooltip
                asChild
                popupContent='Add model credential'
              >
                <Button
                  className='h-6 w-6 rounded-full p-0'
                  size='small'
                  variant='secondary-accent'
                >
                  <RiAddLine className='h-4 w-4' />
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className='system-xs-medium flex h-10 cursor-pointer items-center border-t border-divider-subtle px-4 text-text-accent-light-mode-only'>
            <RiAddLine className='mr-1 h-4 w-4' />
            {t('common.modelProvider.addModel')}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(AddModel)
