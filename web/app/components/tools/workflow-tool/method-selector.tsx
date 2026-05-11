import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

type MethodSelectorProps = {
  value?: string
  onChange: (v: string) => void
}
const MethodSelector: FC<MethodSelectorProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleSelect = (value: string) => {
    onChange(value)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <div className="relative">
        <PopoverTrigger
          nativeButton={false}
          render={(
            <div className={cn(
              'flex h-9 min-h-[56px] cursor-pointer items-center gap-1 bg-transparent px-3 py-2 hover:bg-background-section-burn',
              open && 'bg-background-section-burn! hover:bg-background-section-burn',
            )}
            >
              <div className={cn('grow truncate text-[13px] leading-[18px] text-text-secondary')}>
                {value === 'llm' ? t('createTool.toolInput.methodParameter', { ns: 'tools' }) : t('createTool.toolInput.methodSetting', { ns: 'tools' })}
              </div>
              <div className="ml-1 shrink-0 text-text-secondary opacity-60">
                <RiArrowDownSLine className="h-4 w-4" />
              </div>
            </div>
          )}
        />
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
        >
          <div className="relative w-[320px]">
            <div className="p-1">
              <button
                type="button"
                className="block w-full cursor-pointer rounded-lg border-none bg-transparent py-2.5 pr-2 pl-3 text-left hover:bg-components-panel-on-panel-item-bg-hover"
                onClick={() => handleSelect('llm')}
              >
                <div className="flex items-center gap-1">
                  <div className="h-4 w-4 shrink-0">
                    {value === 'llm' && <Check className="h-4 w-4 shrink-0 text-text-accent" aria-hidden />}
                  </div>
                  <div className="text-[13px] leading-[18px] font-medium text-text-secondary">{t('createTool.toolInput.methodParameter', { ns: 'tools' })}</div>
                </div>
                <div className="pl-5 text-[13px] leading-[18px] text-text-tertiary">{t('createTool.toolInput.methodParameterTip', { ns: 'tools' })}</div>
              </button>
              <button
                type="button"
                className="block w-full cursor-pointer rounded-lg border-none bg-transparent py-2.5 pr-2 pl-3 text-left hover:bg-components-panel-on-panel-item-bg-hover"
                onClick={() => handleSelect('form')}
              >
                <div className="flex items-center gap-1">
                  <div className="h-4 w-4 shrink-0">
                    {value === 'form' && <Check className="h-4 w-4 shrink-0 text-text-accent" aria-hidden />}
                  </div>
                  <div className="text-[13px] leading-[18px] font-medium text-text-secondary">{t('createTool.toolInput.methodSetting', { ns: 'tools' })}</div>
                </div>
                <div className="pl-5 text-[13px] leading-[18px] text-text-tertiary">{t('createTool.toolInput.methodSettingTip', { ns: 'tools' })}</div>
              </button>
            </div>
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default MethodSelector
