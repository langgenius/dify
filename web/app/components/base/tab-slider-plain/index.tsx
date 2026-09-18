'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type Option = {
  value: string
  text: string | React.JSX.Element
}

type ItemProps = Readonly<{
  className?: string
  isActive: boolean
  onClick: (v: string) => void
  option: Option
  smallItem?: boolean
}>
const Item: FC<ItemProps> = ({ className, isActive, onClick, option, smallItem }) => {
  return (
    <button
      type="button"
      key={option.value}
      data-testid={`tab-slider-item-${option.value}`}
      className={cn(
        'relative appearance-none border-0 bg-transparent px-0 pt-0 pb-2.5 text-left',
        !isActive && 'cursor-pointer',
        smallItem ? 'system-sm-semibold-uppercase' : 'system-xl-semibold',
        className,
      )}
      onClick={() => !isActive && onClick(option.value)}
    >
      <span
        data-testid="tab-slider-item-text"
        className={cn('block', isActive ? 'text-text-primary' : 'text-text-tertiary')}
      >
        {option.text}
      </span>
      {isActive && (
        <span
          data-testid="tab-active-indicator"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-util-colors-blue-brand-blue-brand-600"
        ></span>
      )}
    </button>
  )
}

type Props = Readonly<{
  className?: string
  value: string
  onChange: (v: string) => void
  options: Option[]
  noBorderBottom?: boolean
  smallItem?: boolean
  itemClassName?: string
}>

const TabSlider: FC<Props> = ({
  className,
  value,
  onChange,
  options,
  noBorderBottom,
  itemClassName,
  smallItem,
}) => {
  return (
    <div
      data-testid="tab-slider"
      className={cn(
        className,
        !noBorderBottom && 'border-b border-divider-subtle',
        'flex space-x-6',
      )}
    >
      {options.map((option) => (
        <Item
          isActive={option.value === value}
          option={option}
          onClick={onChange}
          key={option.value}
          className={itemClassName}
          smallItem={smallItem}
        />
      ))}
    </div>
  )
}
export default React.memo(TabSlider)
