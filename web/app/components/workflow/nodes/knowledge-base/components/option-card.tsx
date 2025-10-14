import type { ReactNode } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import {
  OptionCardEffectBlue,
  OptionCardEffectBlueLight,
  OptionCardEffectOrange,
  OptionCardEffectPurple,
  OptionCardEffectTeal,
} from '@/app/components/base/icons/src/public/knowledge'
import { ArrowShape } from '@/app/components/base/icons/src/vender/knowledge'

const HEADER_EFFECT_MAP: Record<string, ReactNode> = {
  'blue': <OptionCardEffectBlue />,
  'blue-light': <OptionCardEffectBlueLight />,
  'orange': <OptionCardEffectOrange />,
  'purple': <OptionCardEffectPurple />,
  'teal': <OptionCardEffectTeal />,
}
type OptionCardProps<T> = {
  id?: T
  selectedId?: T
  enableSelect?: boolean
  enableHighlightBorder?: boolean
  enableRadio?: boolean
  wrapperClassName?: string | ((isActive: boolean) => string)
  className?: string | ((isActive: boolean) => string)
  icon?: ReactNode | ((isActive: boolean) => ReactNode)
  title: string
  description?: string
  isRecommended?: boolean
  children?: ReactNode
  effectColor?: string
  onClick?: (id: T) => void
  readonly?: boolean
}
const OptionCard = memo(({
  id,
  selectedId,
  enableSelect = true,
  enableHighlightBorder = true,
  enableRadio,
  wrapperClassName,
  className,
  icon,
  title,
  description,
  isRecommended,
  children,
  effectColor,
  onClick,
  readonly,
}) => {
  const { t } = useTranslation()
  const isActive = useMemo(() => {
    return id === selectedId
  }, [id, selectedId])

  const effectElement = useMemo(() => {
    if (effectColor) {
      return (
        <div className={cn(
          'absolute left-[-2px] top-[-2px] hidden h-14 w-14 rounded-full',
          'group-hover:block',
          isActive && 'block',
        )}>
          {HEADER_EFFECT_MAP[effectColor]}
        </div>
      )
    }

    return null
  }, [effectColor, isActive])

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
        isActive && enableHighlightBorder && 'border-[1.5px] border-components-option-card-option-selected-border',
        enableSelect && 'cursor-pointer hover:shadow-xs',
        readonly && 'cursor-not-allowed',
        wrapperClassName && (typeof wrapperClassName === 'function' ? wrapperClassName(isActive) : wrapperClassName),
      )}
      onClick={(e) => {
        e.stopPropagation()
        if (!readonly && enableSelect && id)
          onClick?.(id)
      }}
    >
      <div className={cn(
        'relative flex rounded-t-xl p-2',
        className && (typeof className === 'function' ? className(isActive) : className),
      )}>
        {effectElement}
        {
          icon && (
            <div className='mr-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center'>
              {typeof icon === 'function' ? icon(isActive) : icon}
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
                    {t('datasetCreation.stepTwo.recommend')}
                  </Badge>
                )
              }
            </div>
            {
              enableRadio && (
                <div className={cn(
                  'ml-2 h-4 w-4 shrink-0 rounded-full border border-components-radio-border bg-components-radio-bg',
                  isActive && 'border-[5px] border-components-radio-border-checked',
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
        children && isActive && (
          <div className='relative rounded-b-xl bg-components-panel-bg p-3'>
            <ArrowShape className='absolute left-[14px] top-[-11px] h-4 w-4 text-components-panel-bg' />
            {children}
          </div>
        )
      }
    </div>
  )
}) as <T>(props: OptionCardProps<T>) => React.ReactElement

export default OptionCard
