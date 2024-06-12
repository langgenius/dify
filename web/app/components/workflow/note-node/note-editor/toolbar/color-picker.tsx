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

export const COLOR_MAP = {
  blue: '#D1E9FF',
  cyan: '#CFF9FE',
  green: '#D3F8DF',
  yellow: '#FEF7C3',
  pink: '#FCE7F6',
  violet: '#ECE9FE',
} as Record<string, string>
export const COLOR_LIST = [
  {
    key: 'blue',
    inner: COLOR_MAP.blue,
    outer: '#2E90FA',
  },
  {
    key: 'cyan',
    inner: COLOR_MAP.cyan,
    outer: '#06AED4',
  },
  {
    key: 'green',
    inner: COLOR_MAP.green,
    outer: '#16B364',
  },
  {
    key: 'yellow',
    inner: COLOR_MAP.yellow,
    outer: '#EAAA08',
  },
  {
    key: 'pink',
    inner: COLOR_MAP.pink,
    outer: '#EE46BC',
  },
  {
    key: 'violet',
    inner: COLOR_MAP.violet,
    outer: '#875BF7',
  },
]

export type ColorPickerProps = {
  onColorChange?: (color: string) => void
}
const ColorPicker = ({
  onColorChange,
}: ColorPickerProps) => {
  const [color, setColor] = useState('blue')
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
          <div
            className='w-4 h-4 rounded-full border border-black/5'
            style={{ backgroundColor: COLOR_MAP[color] }}
          ></div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='grid grid-cols-3 grid-rows-2 gap-0.5 p-0.5 rounded-lg border-[0.5px] border-black/8 bg-white shadow-lg'>
          {
            COLOR_LIST.map(color => (
              <div
                key={color.key}
                className='group relative flex items-center justify-center w-8 h-8 rounded-md cursor-pointer'
                onClick={() => {
                  setColor(color.key)
                  onColorChange?.(color.key)
                  setOpen(false)
                }}
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
