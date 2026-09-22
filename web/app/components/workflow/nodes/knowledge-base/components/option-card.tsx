import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  blue: <OptionCardEffectBlue />,
  'blue-light': <OptionCardEffectBlueLight />,
  orange: <OptionCardEffectOrange />,
  purple: <OptionCardEffectPurple />,
  teal: <OptionCardEffectTeal />,
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
const OptionCard = memo(
  ({
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
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -left-0.5 hidden h-14 w-14 rounded-full',
              'group-hover:block',
              isActive && 'block',
            )}
          >
            {HEADER_EFFECT_MAP[effectColor]}
          </span>
        )
      }

      return null
    }, [effectColor, isActive])

    const Header = enableSelect ? Toggle : 'div'

    return (
      <div
        className={cn(
          'group overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg',
          isActive &&
            enableHighlightBorder &&
            'border-[1.5px] border-components-option-card-option-selected-border',
          enableSelect && 'cursor-pointer hover:shadow-xs',
          readonly && 'cursor-not-allowed',
          wrapperClassName &&
            (typeof wrapperClassName === 'function'
              ? wrapperClassName(isActive)
              : wrapperClassName),
        )}
      >
        <Header
          {...(enableSelect
            ? {
                pressed: isActive,
                disabled: readonly,
                onPressedChange: () => {
                  if (id !== undefined) onClick?.(id)
                },
                onClick: (event: React.MouseEvent) => event.stopPropagation(),
              }
            : {})}
          className={cn(
            'relative flex w-full rounded-t-xl p-2 text-left',
            // React Flow otherwise consumes Space before the native button can activate.
            enableSelect &&
              'nokey cursor-pointer focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden focus-visible:ring-inset disabled:cursor-not-allowed',
            className && (typeof className === 'function' ? className(isActive) : className),
          )}
        >
          {effectElement}
          {!!icon && (
            <span
              aria-hidden="true"
              className="mr-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center"
            >
              {typeof icon === 'function' ? icon(isActive) : icon}
            </span>
          )}
          <span className="block grow py-1 pt-px">
            <span className="flex items-center">
              <span className="flex grow items-center system-sm-medium text-text-secondary">
                {title}
                {isRecommended && (
                  <Badge
                    as="span"
                    className="ml-1 h-4 border-text-accent-secondary text-text-accent-secondary"
                  >
                    {t(($) => $['stepTwo.recommend'], { ns: 'datasetCreation' })}
                  </Badge>
                )}
              </span>
              {enableRadio && (
                <span
                  className={cn(
                    'ml-2 size-4 shrink-0 rounded-full border border-components-radio-border bg-components-radio-bg',
                    isActive && 'border-[5px] border-components-radio-border-checked',
                  )}
                ></span>
              )}
            </span>
            {description && (
              <span className="mt-1 block system-xs-regular text-text-tertiary">{description}</span>
            )}
          </span>
        </Header>
        {!!(children && isActive) && (
          <div className="relative rounded-b-xl bg-components-panel-bg p-3">
            <ArrowShape className="absolute -top-2.75 left-3.5 h-4 w-4 text-components-panel-bg" />
            {children}
          </div>
        )}
      </div>
    )
  },
) as <T>(props: OptionCardProps<T>) => React.ReactElement

export default OptionCard
