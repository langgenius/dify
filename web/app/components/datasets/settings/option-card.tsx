import type { ReactNode } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import { useTranslation } from 'react-i18next'
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
  showHighlightBorder?: boolean
  icon?: ReactNode
  title: string
  description?: string
  isRecommended?: boolean
  effectColor?: EffectColor
  showEffectColor?: boolean
  onClick?: (id: T) => void
}
const OptionCard = <T,>({
  id,
  className,
  showHighlightBorder,
  icon,
  title,
  description,
  isRecommended,
  effectColor,
  showEffectColor,
  onClick,
}: OptionCardProps<T>) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'cursor-pointer overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
        showHighlightBorder && 'border border-components-option-card-option-selected-border ring-[0.5px] ring-inset ring-components-option-card-option-selected-border',
      )}
      onClick={() => onClick?.(id)}
    >
      <div className={cn(
        'relative flex rounded-t-xl p-2',
        className,
      )}>
        {
          effectColor && showEffectColor && (
            <div className={cn(
              'absolute left-[-2px] top-[-2px] h-14 w-14 rounded-full blur-[80px]',
              `${HEADER_EFFECT_MAP[effectColor]}`,
            )}/>
          )
        }
        {
          icon && (
            <div className='flex size-6 shrink-0 items-center justify-center'>
              {icon}
            </div>
          )
        }
        <div className='flex grow flex-col gap-y-0.5 py-px'>
          <div className='flex items-center gap-x-1'>
            <span className='system-sm-medium grow text-text-secondary'>
              {title}
            </span>
            {
              isRecommended && (
                <Badge className='h-[18px] border-text-accent-secondary text-text-accent-secondary'>
                  {t('datasetCreation.stepTwo.recommend')}
                </Badge>
              )
            }
          </div>
          {
            description && (
              <div className='system-xs-regular text-text-tertiary'>
                {description}
              </div>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(OptionCard)
