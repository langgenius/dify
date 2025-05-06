import type { ReactNode } from 'react'
import { memo } from 'react'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import {
  OptionCardEffectBlue,
  OptionCardEffectBlueLight,
  OptionCardEffectOrange,
  OptionCardEffectPurple,
} from '@/app/components/base/icons/src/public/knowledge'
import { ArrowShape } from '@/app/components/base/icons/src/vender/knowledge'

const HEADER_EFFECT_MAP: Record<string, ReactNode> = {
  'blue': <OptionCardEffectBlue />,
  'blue-light': <OptionCardEffectBlueLight />,
  'orange': <OptionCardEffectOrange />,
  'purple': <OptionCardEffectPurple />,
}
type OptionCardProps<T> = {
  id: T
  className?: string
  showHighlightBorder?: boolean
  showRadio?: boolean
  radioIsActive?: boolean
  icon?: ReactNode
  title: string
  description?: string
  isRecommended?: boolean
  children?: ReactNode
  showChildren?: boolean
  effectColor?: string
  showEffectColor?: boolean
  onClick?: (id: T) => void
}
const OptionCard = memo(({
  id,
  className,
  showHighlightBorder,
  showRadio,
  radioIsActive,
  icon,
  title,
  description,
  isRecommended,
  children,
  showChildren,
  effectColor,
  showEffectColor,
  onClick,
}) => {
  return (
    <div
      className={cn(
        'cursor-pointer rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
        showHighlightBorder && 'border-[2px] border-components-option-card-option-selected-border',
      )}
      onClick={() => onClick?.(id)}
    >
      <div className={cn(
        'relative flex rounded-t-xl p-2',
        className,
      )}>
        {
          effectColor && showEffectColor && (
            <div className='absolute left-[-2px] top-[-2px] h-14 w-14 rounded-full'>
              {HEADER_EFFECT_MAP[effectColor]}
            </div>
          )
        }
        {
          icon && (
            <div className='mr-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center'>
              {icon}
            </div>
          )
        }
        <div className='grow py-1 pt-[1px]'>
          <div className='flex items-center'>
            <div className='system-sm-medium flex grow items-center text-text-secondary'>
              {title}
              {
                isRecommended && (
                  <Badge className='ml-1 h-4 border-text-accent-secondary text-text-accent-secondary'>
                    Recommend
                  </Badge>
                )
              }
            </div>
            {
              showRadio && (
                <div className={cn(
                  'ml-2 h-4 w-4 shrink-0 rounded-full border border-components-radio-border bg-components-radio-bg',
                  radioIsActive && 'border-[5px] border-components-radio-border-checked',
                )}>
                </div>
              )
            }
          </div>
          {
            description && (
              <div className='system-xs-regular mt-1 text-text-tertiary'>
                {description}
              </div>
            )
          }
        </div>
      </div>
      {
        children && showChildren && (
          <div className='relative rounded-b-xl bg-components-panel-bg p-3'>
            <ArrowShape className='absolute left-[14px] top-[-11px] h-4 w-4 text-components-panel-bg' />
            {children}
          </div>
        )
      }
    </div>
  )
}) as <T>(props: OptionCardProps<T>) => JSX.Element

export default OptionCard
