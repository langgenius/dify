'use client'
import type { FC } from 'react'
import type { Item } from '@/app/components/base/select'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import DisplayToggle from '../display-toggle'
import StatusItem from '../status-item'
import s from '../style.module.css'

type MenuBarProps = {
  isAllSelected: boolean
  isSomeSelected: boolean
  onSelectedAll: () => void
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

const MenuBar: FC<MenuBarProps> = ({
  isAllSelected,
  isSomeSelected,
  onSelectedAll,
  isLoading,
  totalText,
  statusList,
  selectDefaultValue,
  onChangeStatus,
  inputValue,
  onInputChange,
  isCollapsed,
  toggleCollapsed,
}) => {
  return (
    <div className={s.docSearchWrapper}>
      <Checkbox
        className="shrink-0"
        checked={isAllSelected}
        indeterminate={!isAllSelected && isSomeSelected}
        onCheck={onSelectedAll}
        disabled={isLoading}
      />
      <div className="system-sm-semibold-uppercase flex-1 pl-5 text-text-secondary">{totalText}</div>
      <SimpleSelect
        onSelect={onChangeStatus}
        items={statusList}
        defaultValue={selectDefaultValue}
        className={s.select}
        wrapperClassName="h-fit mr-2"
        optionWrapClassName="w-[160px]"
        optionClassName="p-0"
        renderOption={({ item, selected }) => <StatusItem item={item} selected={selected} />}
        notClearable
      />
      <Input
        showLeftIcon
        showClearIcon
        wrapperClassName="!w-52"
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
