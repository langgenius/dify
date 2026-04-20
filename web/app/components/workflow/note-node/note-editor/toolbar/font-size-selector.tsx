import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiFontSize } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { useFontSize } from './hooks'

const FontSizeSelector = () => {
  const { t } = useTranslation()
  const FONT_SIZE_LIST = [
    {
      key: '12px',
      value: t('nodes.note.editor.small', { ns: 'workflow' }),
    },
    {
      key: '14px',
      value: t('nodes.note.editor.medium', { ns: 'workflow' }),
    },
    {
      key: '16px',
      value: t('nodes.note.editor.large', { ns: 'workflow' }),
    },
  ]
  const {
    fontSizeSelectorShow,
    handleOpenFontSizeSelector,
    fontSize,
    handleFontSize,
  } = useFontSize()

  return (
    <Popover
      open={fontSizeSelectorShow}
      onOpenChange={handleOpenFontSizeSelector}
    >
      <PopoverTrigger
        nativeButton
        render={(
          <button
            type="button"
            className={cn(
              'flex h-8 cursor-pointer items-center rounded-md pr-1.5 pl-2 text-[13px] font-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
              fontSizeSelectorShow && 'bg-state-base-hover text-text-secondary',
            )}
          >
            <RiFontSize className="mr-1 h-4 w-4" />
            {FONT_SIZE_LIST.find(font => font.key === fontSize)?.value || t('nodes.note.editor.small', { ns: 'workflow' })}
          </button>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={2}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[120px] rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 text-text-secondary shadow-xl">
          {
            FONT_SIZE_LIST.map(font => (
              <div
                key={font.key}
                className="flex h-8 cursor-pointer items-center justify-between rounded-md pr-2 pl-3 hover:bg-state-base-hover"
                onClick={(e) => {
                  e.stopPropagation()
                  handleFontSize(font.key)
                  handleOpenFontSizeSelector(false)
                }}
              >
                <div
                  style={{ fontSize: font.key }}
                >
                  {font.value}
                </div>
                {
                  fontSize === font.key && (
                    <Check className="h-4 w-4 text-text-accent" />
                  )
                }
              </div>
            ))
          }
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(FontSizeSelector)
