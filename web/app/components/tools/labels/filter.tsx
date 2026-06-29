import type { FC } from 'react'
import type { Label } from '@/app/components/tools/labels/constant'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiArrowDownSLine } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import { Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'
import Input from '@/app/components/base/input'
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
            'flex h-8 cursor-pointer items-center gap-0 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-3 text-left select-none hover:bg-components-input-bg-hover',
            !!value.length && 'pr-7',
          )}
        >
          <div className="flex min-w-0 items-center p-1">
            <div className="min-w-0 truncate text-[13px] leading-4 text-text-tertiary">
              {!value.length && t('tag.tags', { ns: 'common' })}
              {!!value.length && currentLabel?.label}
            </div>
          </div>
          {value.length > 1 && (
            <div className="shrink-0 text-[13px] leading-4 font-normal text-text-tertiary">{`+${value.length - 1}`}</div>
          )}
          {!value.length && (
            <RiArrowDownSLine className="size-4 shrink-0 text-text-tertiary" />
          )}
        </PopoverTrigger>
        {!!value.length && (
          <button
            type="button"
            aria-label={t('operation.clear', { ns: 'common' })}
            className="group/clear absolute top-1/2 right-2 -translate-y-1/2 border-none bg-transparent p-px"
            onClick={() => onChange([])}
          >
            <XCircle className="size-3.5 text-text-tertiary group-hover/clear:text-text-secondary" aria-hidden="true" />
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
                  className="flex w-full items-center gap-2 rounded-lg border-none bg-transparent py-[6px] pr-2 pl-3 text-left select-none hover:bg-state-base-hover"
                  onClick={() => selectLabel(label)}
                >
                  <div className="grow truncate text-sm/5 text-text-secondary">{label.label}</div>
                  {value.includes(label.name) && <Check className="size-4 shrink-0 text-text-accent" aria-hidden="true" />}
                </button>
              ))}
              {!filteredLabelList.length && (
                <div className="flex flex-col items-center gap-1 p-3">
                  <Tag03 className="size-6 text-text-quaternary" />
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
