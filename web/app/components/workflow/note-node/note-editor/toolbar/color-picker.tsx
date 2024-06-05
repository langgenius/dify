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

const COLOR_LIST = [
  {
    key: 'blue',
    inner: '#D1E9FF',
    outer: '#2E90FA',
  },
  {
    key: 'cyan',
    inner: '#CFF9FE',
    outer: '#06AED4',
  },
  {
    key: 'green',
    inner: '#D3F8DF',
    outer: '#16B364',
  },
  {
    key: 'yellow',
    inner: '#FEF7C3',
    outer: '#EAAA08',
  },
  {
    key: 'pink',
    inner: '#FCE7F6',
    outer: '#EE46BC',
  },
  {
    key: 'violet',
    inner: '#ECE9FE',
    outer: '#875BF7',
  },
]

const ColorPicker = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-md cursor-pointer hover:bg-black/5',
          open && 'bg-black/5',
        )}>
          <div className='w-4 h-4 rounded-full border border-black/5 bg-blue-100'></div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='grid grid-cols-3 grid-rows-2 gap-0.5 p-0.5 rounded-lg border-[0.5px] border-black/8 bg-white shadow-lg'>
          {
            COLOR_LIST.map(color => (
              <div
                key={color.key}
                className='group relative flex items-center justify-center w-8 h-8 rounded-md cursor-pointer'
              >
                <div
                  className='hidden group-hover:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-[1.5px]'
                  style={{ borderColor: color.outer }}
                ></div>
                <div
                  className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-black/5'
                  style={{ backgroundColor: color.inner }}
                ></div>
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ColorPicker)
