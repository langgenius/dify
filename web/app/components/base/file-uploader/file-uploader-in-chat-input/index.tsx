import {
  memo,
  useState,
} from 'react'
import {
  RiAttachmentLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'

const FileUploaderInChatInput = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <ActionButton size='l'>
          <RiAttachmentLine className='w-5 h-5' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-3 w-[280px] bg-components-panel-bg-blur border-[0.5px] border-components-panel-border rounded-xl shadow-lg'>
          <div className='flex items-center p-1 bg-components-input-bg-active border border-components-input-border-active rounded-lg shadow-xs'>
            <input
              className='mr-0.5 p-1 appearance-none system-sm-regular text-text-secondary'
              placeholder='Enter URL...'
            />
            <Button
              size='small'
              variant='primary'
            >
              OK ↩
            </Button>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(FileUploaderInChatInput)
