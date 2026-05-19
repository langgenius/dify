'use client'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import DisplayToggle from '../display-toggle'
import StatusItem from '../status-item'
import s from '../style.module.css'

type Item = {
  value: number | string
  name: string
} & Record<string, unknown>

type MenuBarProps = {
  hasSelectableSegments: boolean
  isLoading: boolean
  totalText: string
  statusList: Item[]
  selectDefaultValue: 'all' | 0 | 1
  onChangeStatus: (item: Item) => void
  inputValue: string
  onInputChange: (value: string) => void
  isCollapsed: boolean
  toggleCollapsed: () => void
}

function MenuBar({
  hasSelectableSegments,
  isLoading,
  totalText,
  statusList,
  selectDefaultValue,
  onChangeStatus,
  inputValue,
  onInputChange,
  isCollapsed,
  toggleCollapsed,
}: MenuBarProps) {
  const { t } = useTranslation()
  const selectedStatus = statusList.find(item => item.value === selectDefaultValue) ?? null

  return (
    <div className={s.docSearchWrapper}>
      {hasSelectableSegments
        ? (
            <Checkbox
              className="shrink-0"
              parent
              aria-label={t('operation.selectAll', { ns: 'common' })}
              disabled={isLoading}
            />
          )
        : (
            <span className="size-4 shrink-0" aria-hidden />
          )}
      <div className="flex-1 pl-5 system-sm-semibold-uppercase text-text-secondary">{totalText}</div>
      <Select
        value={selectedStatus ? String(selectedStatus.value) : null}
        onValueChange={(nextValue) => {
          if (!nextValue)
            return
          const nextItem = statusList.find(item => String(item.value) === nextValue)
          if (nextItem)
            onChangeStatus(nextItem)
        }}
      >
        <SelectTrigger className={cn(s.select, 'mr-2 h-fit')}>
          {selectedStatus?.name ?? ''}
        </SelectTrigger>
        <SelectContent popupClassName="w-[160px]">
          {statusList.map(item => (
            <SelectItem key={item.value} value={String(item.value)} className="h-auto p-0">
              <SelectItemText className="sr-only m-0 p-0">{item.name}</SelectItemText>
              <StatusItem item={item} selected={item.value === selectDefaultValue} />
              {item.value === selectDefaultValue && <SelectItemIndicator className="hidden" />}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        showLeftIcon
        showClearIcon
        wrapperClassName="w-52!"
        value={inputValue}
        onChange={e => onInputChange(e.target.value)}
        onClear={() => onInputChange('')}
      />
      <Divider type="vertical" className="mx-3 h-3.5" />
      <DisplayToggle isCollapsed={isCollapsed} toggleCollapsed={toggleCollapsed} />
    </div>
  )
}

export default MenuBar
