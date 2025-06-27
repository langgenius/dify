import { RiAddLine } from '@remixicon/react'
import Item from './item'
import Button from '@/app/components/base/button'

const Card = () => {
  return (
    <div className='rounded-xl bg-background-section-burn'>
      <div className='flex items-center p-3 pb-2'>
        <div className='mr-3 flex h-10 w-10 shrink-0 items-center justify-center'></div>
        <div className='grow'>
          <div className='system-md-semibold text-text-primary'>
            Notion Data Source
          </div>
          <div className='system-xs-regular flex h-4 items-center text-text-tertiary'>
            langgenius
            <div className='text-text-quaternary'>/</div>
            notion-data-source
          </div>
        </div>
        <Button
          variant='secondary-accent'
        >
          <RiAddLine className='h-4 w-4' />
          Configure
        </Button>
      </div>
      <div className='system-xs-medium flex h-4 items-center pl-3 text-text-tertiary'>
        Connected workspace
        <div className='ml-3 h-[1px] grow bg-divider-subtle'></div>
      </div>
      <div className='space-y-1 p-3 pt-2'>
        <Item />
        <Item />
        <Item />
      </div>
      <div className='p-3 pt-1'>
        <div className='system-xs-regular flex h-10 items-center justify-center rounded-[10px] bg-background-section text-text-tertiary'>
          Please configure authentication
        </div>
      </div>
    </div>
  )
}

export default Card
