import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useDebounceFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import Input from '@/app/components/base/input'
import { useTags } from '@/app/components/plugins/hooks'

type LabelSelectorProps = {
  value: string[]
  onChange: (v: string[]) => void
}

function LabelSelector({
  value,
  onChange,
}: LabelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const { tags: labelList } = useTags()

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const filteredLabelList = labelList.filter(label => label.name.includes(searchKeywords))
  const selectedLabels = value.map(v => labelList.find(l => l.name === v)?.label).join(', ')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger
          className={cn(
            'flex h-10 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-3 text-left hover:bg-components-input-bg-hover',
            'data-popup-open:bg-components-input-bg-hover data-popup-open:hover:bg-components-input-bg-hover',
          )}
        >
          <div className={cn('grow truncate text-[13px] leading-4.5 text-text-secondary', !value.length && 'text-text-quaternary!')}>
            {!value.length && t('createTool.toolInput.labelPlaceholder', { ns: 'tools' })}
            {!!value.length && selectedLabels}
          </div>
          <div className="ml-1 shrink-0 text-text-secondary opacity-60">
            <span className="i-ri-arrow-down-s-line size-4" />
          </div>
        </PopoverTrigger>
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <div className="relative w-[591px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
            <div className="border-b-[0.5px] border-divider-regular p-2">
              <Input
                showLeftIcon
                showClearIcon
                value={keywords}
                onChange={e => handleKeywordsChange(e.target.value)}
                onClear={() => handleKeywordsChange('')}
              />
            </div>
            <CheckboxGroup
              aria-label={t('createTool.toolInput.labelPlaceholder', { ns: 'tools' })}
              value={value}
              onValueChange={nextValue => onChange(nextValue)}
              className="max-h-[264px] overflow-y-auto p-1"
            >
              {filteredLabelList.map(label => (
                <label
                  key={label.name}
                  className="flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pr-2 pl-3 hover:bg-components-panel-on-panel-item-bg-hover"
                >
                  <Checkbox
                    className="shrink-0"
                    value={label.name}
                  />
                  <div className="grow truncate text-sm/5 text-text-secondary">{label.label}</div>
                </label>
              ))}
              {!filteredLabelList.length && (
                <div className="flex flex-col items-center gap-1 p-3">
                  <Tag03 className="size-6 text-text-quaternary" />
                  <div className="text-xs leading-[14px] text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
                </div>
              )}
            </CheckboxGroup>
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default LabelSelector
