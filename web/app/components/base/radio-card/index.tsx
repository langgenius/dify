'use client'
import type { RadioItemProps } from '@langgenius/dify-ui/radio'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioItem } from '@langgenius/dify-ui/radio'

type BaseProps = {
  className?: string
  icon: ReactNode
  iconBgClassName?: string
  title: ReactNode
  description: string
  chosenConfig?: ReactNode
  chosenConfigWrapClassName?: string
}

type SelectableRadioCardProps<Value = string> = BaseProps & {
  noRadio?: false
} & Omit<RadioItemProps<Value>, 'children' | 'className' | 'render' | 'nativeButton'>

type StaticRadioCardProps = BaseProps & {
  noRadio: true
  value?: never
  checked?: never
}

type Props<Value = string> = SelectableRadioCardProps<Value> | StaticRadioCardProps

function RadioCard<Value = string>(props: Props<Value>) {
  if (props.noRadio) {
    const {
      icon,
      iconBgClassName = 'bg-[#F5F3FF]',
      title,
      description,
      chosenConfig,
      chosenConfigWrapClassName,
      className,
    } = props

    return (
      <div className={cn(
        'relative rounded-xl border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg p-3',
        className,
      )}
      >
        <div className="flex w-full gap-x-2 text-left">
          <div className={cn(iconBgClassName, 'flex size-8 shrink-0 items-center justify-center rounded-lg shadow-md')}>
            {icon}
          </div>
          <div className="min-w-0 grow pr-8">
            <div className="mb-1 system-sm-semibold text-text-secondary">{title}</div>
            <div className="system-xs-regular text-text-tertiary">{description}</div>
          </div>
        </div>
        {Boolean(chosenConfig) && (
          <div className="mt-2 flex gap-x-2">
            <div className="size-8 shrink-0"></div>
            <div className={cn(chosenConfigWrapClassName, 'grow')}>
              {chosenConfig}
            </div>
          </div>
        )}
      </div>
    )
  }

  const {
    icon,
    iconBgClassName = 'bg-[#F5F3FF]',
    title,
    description,
    chosenConfig,
    chosenConfigWrapClassName,
    className,
    noRadio: _noRadio,
    ...radioRootProps
  } = props

  const content = (
    <>
      <div className={cn(iconBgClassName, 'flex size-8 shrink-0 items-center justify-center rounded-lg shadow-md')}>
        {icon}
      </div>
      <div className="min-w-0 grow pr-8">
        <div className="mb-1 system-sm-semibold text-text-secondary">{title}</div>
        <div className="system-xs-regular text-text-tertiary">{description}</div>
      </div>
    </>
  )
  const rootClassName = cn(
    'group/radio-card relative rounded-xl border-[0.5px] border-components-option-card-option-border bg-components-option-card-option-bg p-3 transition-colors',
    'has-[[data-checked]]:border-[1.5px] has-[[data-checked]]:bg-components-option-card-option-selected-bg',
    className,
  )
  const config = !!chosenConfig && (
    <div className="mt-2 hidden gap-x-2 group-has-data-checked/radio-card:flex">
      <div className="size-8 shrink-0"></div>
      <div className={cn(chosenConfigWrapClassName, 'grow')}>
        {chosenConfig}
      </div>
    </div>
  )

  return (
    <div
      className={rootClassName}
    >
      <RadioItem<Value>
        {...radioRootProps}
        nativeButton
        render={<button type="button" />}
        className="flex w-full cursor-pointer gap-x-2 border-none bg-transparent p-0 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-active"
      >
        {content}
        <RadioControl className="absolute top-3 right-3" aria-hidden="true" />
      </RadioItem>
      {config}
    </div>
  )
}

export default RadioCard
