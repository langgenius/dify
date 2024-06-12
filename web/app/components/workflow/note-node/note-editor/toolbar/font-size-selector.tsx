import { memo } from 'react'
import cn from 'classnames'
import { useFontSize } from './hooks'
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
    value: '12px',
  },
  {
    key: 'Medium',
    value: '14px',
  },
  {
    key: 'Large',
    value: '16px',
  },
]
const FontSizeSelector = () => {
  const {
    fontSizeSelectorShow,
    handleOpenFontSizeSelector,
    fontSize,
    handleFontSize,
  } = useFontSize()

  return (
    <PortalToFollowElem
      open={fontSizeSelectorShow}
      onOpenChange={handleOpenFontSizeSelector}
      placement='bottom-start'
      offset={2}
    >
      <PortalToFollowElemTrigger onClick={() => handleOpenFontSizeSelector(!fontSizeSelectorShow)}>
        <div className={cn(
          'flex items-center pl-2 pr-1.5 h-8 rounded-md text-[13px] font-medium text-gray-700 cursor-pointer hover:bg-gray-50',
          fontSizeSelectorShow && 'bg-gray-50',
        )}>
          <TitleCase className='mr-1 w-4 h-4' />
          {FONT_SIZE_LIST.find(font => font.value === fontSize)?.key || 'Small'}
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
                onClick={() => {
                  handleFontSize(font.value)
                  handleOpenFontSizeSelector(false)
                }}
              >
                <div
                  style={{ fontSize: font.value }}
                >
                  {font.key}
                </div>
                {
                  fontSize === font.value && (
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
