import {
  memo,
  useState,
} from 'react'
import { NoteTheme } from '../../types'
import { THEME_MAP } from '../../constants'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export const COLOR_LIST = [
  {
    key: NoteTheme.blue,
    inner: THEME_MAP[NoteTheme.blue].title,
    outer: THEME_MAP[NoteTheme.blue].outer,
  },
  {
    key: NoteTheme.cyan,
    inner: THEME_MAP[NoteTheme.cyan].title,
    outer: THEME_MAP[NoteTheme.cyan].outer,
  },
  {
    key: NoteTheme.green,
    inner: THEME_MAP[NoteTheme.green].title,
    outer: THEME_MAP[NoteTheme.green].outer,
  },
  {
    key: NoteTheme.yellow,
    inner: THEME_MAP[NoteTheme.yellow].title,
    outer: THEME_MAP[NoteTheme.yellow].outer,
  },
  {
    key: NoteTheme.pink,
    inner: THEME_MAP[NoteTheme.pink].title,
    outer: THEME_MAP[NoteTheme.pink].outer,
  },
  {
    key: NoteTheme.violet,
    inner: THEME_MAP[NoteTheme.violet].title,
    outer: THEME_MAP[NoteTheme.violet].outer,
  },
]

export type ColorPickerProps = {
  theme: NoteTheme
  onThemeChange: (theme: NoteTheme) => void
}
const ColorPicker = ({
  theme,
  onThemeChange,
}: ColorPickerProps) => {
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
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-black/5',
          open && 'bg-black/5',
        )}>
          <div
            className={cn(
              'h-4 w-4 rounded-full border border-black/5',
              THEME_MAP[theme].title,
            )}
          ></div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='grid grid-cols-3 grid-rows-2 gap-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg'>
          {
            COLOR_LIST.map(color => (
              <div
                key={color.key}
                className='group relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md'
                onClick={(e) => {
                  e.stopPropagation()
                  onThemeChange(color.key)
                  setOpen(false)
                }}
              >
                <div
                  className={cn(
                    'absolute left-1/2 top-1/2 hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] group-hover:block',
                    color.outer,
                  )}
                ></div>
                <div
                  className={cn(
                    'absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/5',
                    color.inner,
                  )}
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
