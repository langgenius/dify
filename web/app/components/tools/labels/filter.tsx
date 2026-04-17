import type { FC } from 'react'
import type { Label } from '@/app/components/tools/labels/constant'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDownSLine } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import Input from '@/app/components/base/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { useTags } from '@/app/components/plugins/hooks'

type LabelFilterProps = {
  value: string[]
  onChange: (v: string[]) => void
}
const LabelFilter: FC<LabelFilterProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { tags: labelList } = useTags()

  const [keywords, setKeywords] = useState('')

  const filteredLabelList = useMemo(() => {
    return labelList.filter(label => label.name.includes(keywords))
  }, [labelList, keywords])

  const currentLabel = useMemo(() => {
    return labelList.find(label => label.name === value[0])
  }, [value, labelList])

  const selectLabel = (label: Label) => {
    if (value.includes(label.name))
      onChange(value.filter(v => v !== label.name))
    else
      onChange([...value, label.name])
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <div className="relative">
        <PopoverTrigger
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 text-left select-none hover:bg-components-input-bg-hover',
            !!value.length && 'pr-6 shadow-xs',
          )}
        >
          <div className="p-px">
            <Tag01 className="h-3.5 w-3.5 text-text-tertiary" />
          </div>
          <div className="min-w-0 truncate text-[13px] leading-[18px] text-text-tertiary">
            {!value.length && t('tag.placeholder', { ns: 'common' })}
            {!!value.length && currentLabel?.label}
          </div>
          {value.length > 1 && (
            <div className="shrink-0 text-xs leading-[18px] font-medium text-text-tertiary">{`+${value.length - 1}`}</div>
          )}
          {!value.length && (
            <div className="shrink-0 p-px">
              <RiArrowDownSLine className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
          )}
        </PopoverTrigger>
        {!!value.length && (
          <button
            type="button"
            aria-label={t('operation.clear', { ns: 'common' })}
            className="group/clear absolute top-1/2 right-2 -translate-y-1/2 p-px"
            data-testid="label-filter-clear-button"
            onClick={() => onChange([])}
          >
            <XCircle className="h-3.5 w-3.5 text-text-tertiary group-hover/clear:text-text-secondary" />
          </button>
        )}
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]"
        >
          <div className="relative">
            <div className="p-2">
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                onClear={() => setKeywords('')}
              />
            </div>
            <div className="p-1">
              {filteredLabelList.map(label => (
                <button
                  key={label.name}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg py-[6px] pr-2 pl-3 text-left select-none hover:bg-state-base-hover"
                  onClick={() => selectLabel(label)}
                >
                  <div title={label.label} className="grow truncate text-sm leading-5 text-text-secondary">{label.label}</div>
                  {value.includes(label.name) && <Check className="h-4 w-4 shrink-0 text-text-accent" />}
                </button>
              ))}
              {!filteredLabelList.length && (
                <div className="flex flex-col items-center gap-1 p-3">
                  <Tag03 className="h-6 w-6 text-text-quaternary" />
                  <div className="text-xs leading-[14px] text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </div>
    </Popover>

  )
}

export default LabelFilter
