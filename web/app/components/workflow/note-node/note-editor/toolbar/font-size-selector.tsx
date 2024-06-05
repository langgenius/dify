import {
  memo,
  useState,
} from 'react'
import cn from 'classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { TitleCase } from '@/app/components/base/icons/src/vender/line/editor'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

const FONT_SIZE_LIST = [
  {
    key: 'Small',
    value: 12,
  },
  {
    key: 'Medium',
    value: 14,
  },
  {
    key: 'Large',
    value: 16,
  },
]
const FontSizeSelector = () => {
  const [value] = useState(FONT_SIZE_LIST[0].key)
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={2}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div className={cn(
          'flex items-center pl-2 pr-1.5 h-8 rounded-md text-[13px] font-medium text-gray-700 cursor-pointer hover:bg-gray-50',
          open && 'bg-gray-50',
        )}>
          <TitleCase className='mr-1 w-4 h-4' />
          {value}
          <ChevronDown className='ml-0.5 w-3 h-3' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 w-[120px] bg-white border-[0.5px] border-gray-200 rounded-md shadow-xl text-gray-700'>
          {
            FONT_SIZE_LIST.map(font => (
              <div
                key={font.key}
                className='flex items-center justify-between pl-3 pr-2 h-8 rounded-md cursor-pointer hover:bg-gray-50'
              >
                <div
                  style={{ fontSize: font.value }}
                >
                  {font.key}
                </div>
                {
                  value === font.key && (
                    <Check className='w-4 h-4 text-primary-500' />
                  )
                }
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(FontSizeSelector)
