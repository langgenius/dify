import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio-group'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { EffectColor } from './chunk-structure/types'

const HEADER_EFFECT_MAP: Record<EffectColor, string> = {
  [EffectColor.indigo]: 'bg-util-colors-indigo-indigo-600 opacity-50',
  [EffectColor.blueLight]: 'bg-util-colors-blue-light-blue-light-600 opacity-80',
  [EffectColor.orange]: 'bg-util-colors-orange-orange-500 opacity-50',
  [EffectColor.purple]: 'bg-util-colors-purple-purple-600 opacity-80',
}
type OptionCardProps<T> = {
  id: T
  className?: string
  isActive?: boolean
  icon?: ReactNode
  iconActiveColor?: string
  title: string
  description?: string
  isRecommended?: boolean
  effectColor?: EffectColor
  showEffectColor?: boolean
  disabled?: boolean
  children?: ReactNode
  showChildren?: boolean
  ref?: React.Ref<HTMLDivElement>
}
const OptionCard = <T,>({
  id,
  className,
  isActive,
  icon,
  iconActiveColor,
  title,
  description,
  isRecommended,
  effectColor,
  showEffectColor,
  disabled,
  children,
  showChildren,
  ref,
}: OptionCardProps<T>) => {
  const { t } = useTranslation()
  const titleId = React.useId()
  const descriptionId = React.useId()

  return (
    <div
      ref={ref}
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
        isActive &&
          'border border-components-option-card-option-selected-border ring-[1px] ring-components-option-card-option-selected-border',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <RadioItem<T>
        value={id}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative flex w-full cursor-pointer rounded-t-xl border-0 bg-transparent p-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
          className,
        )}
      >
        {effectColor && showEffectColor && (
          <div
            className={cn(
              'absolute -top-0.5 -left-0.5 h-14 w-14 rounded-full blur-[80px]',
              `${HEADER_EFFECT_MAP[effectColor]}`,
            )}
          />
        )}
        {!!icon && (
          <div
            className={cn(
              'flex size-6 shrink-0 items-center justify-center text-text-tertiary',
              isActive && iconActiveColor,
            )}
          >
            {icon}
          </div>
        )}
        <div className="flex min-w-0 grow flex-col gap-y-0.5 py-px">
          <div className="flex items-center gap-x-1">
            <span id={titleId} className="system-sm-medium text-text-secondary">
              {title}
            </span>
            {isRecommended && (
              <Badge className="h-4.5 border-text-accent-secondary text-text-accent-secondary">
                {t(($) => $['stepTwo.recommend'], { ns: 'datasetCreation' })}
              </Badge>
            )}
          </div>
          {description && (
            <div id={descriptionId} className="system-xs-regular text-text-tertiary">
              {description}
            </div>
          )}
        </div>
      </RadioItem>
      {!!(children && showChildren) && (
        <div
          role="presentation"
          className="relative rounded-b-xl bg-components-panel-bg p-4"
          onKeyDown={(event) => {
            // Keep parameter arrow keys from navigating the enclosing radio group.
            if (event.key.startsWith('Arrow')) event.stopPropagation()
          }}
        >
          <span
            aria-hidden
            className="absolute -top-2.75 left-3.5 i-custom-vender-knowledge-arrow-shape size-4 text-components-panel-bg"
          />
          {children}
        </div>
      )}
    </div>
  )
}

export default React.memo(OptionCard) as typeof OptionCard
