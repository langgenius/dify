import type { ComponentProps, FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio-group'
import { useId } from 'react'

const TriangleArrow: FC<ComponentProps<'svg'>> = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="11"
    viewBox="0 0 24 11"
    fill="none"
    {...props}
  >
    <path
      d="M9.87868 1.12132C11.0503 -0.0502525 12.9497 -0.0502525 14.1213 1.12132L23.3137 10.3137H0.686292L9.87868 1.12132Z"
      fill="currentColor"
    />
  </svg>
)

type OptionCardHeaderProps = {
  icon: ReactNode
  title: ReactNode
  description: string
  isActive?: boolean
  activeClassName?: string
  effectImg?: string
  disabled?: boolean
  titleId?: string
  descriptionId?: string
}

const OptionCardHeader: FC<OptionCardHeaderProps> = (props) => {
  const {
    icon,
    title,
    description,
    isActive,
    activeClassName,
    effectImg,
    disabled,
    titleId,
    descriptionId,
  } = props
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-1 overflow-hidden rounded-t-xl',
        isActive && activeClassName,
        !disabled && 'cursor-pointer',
      )}
    >
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden">
        {isActive && effectImg && (
          <img
            src={effectImg}
            className="absolute top-0 left-0 size-full"
            alt=""
            width={56}
            height={56}
          />
        )}
        <div className="p-1">
          <div className="flex size-8 items-center justify-center rounded-lg border border-components-panel-border-subtle bg-background-default-dodge p-1.5 shadow-md">
            {icon}
          </div>
        </div>
      </div>
      <TriangleArrow
        className={cn(
          'absolute -bottom-1.5 left-4 text-transparent',
          isActive && 'text-components-panel-bg',
        )}
      />
      <div className="min-w-0 flex-1 space-y-0.5 py-3 pr-4">
        <div id={titleId} className="system-md-semibold text-text-secondary">
          {title}
        </div>
        <div id={descriptionId} className="system-xs-regular text-text-tertiary">
          {description}
        </div>
      </div>
    </div>
  )
}

type OptionCardProps<Value> = {
  value: Value
  icon: ReactNode
  className?: string
  activeHeaderClassName?: string
  title: ReactNode
  description: string
  isActive?: boolean
  actions?: ReactNode
  effectImg?: string
  noHighlight?: boolean
  disabled?: boolean
} & Omit<ComponentProps<'div'>, 'title' | 'onClick'>

export const OptionCard = <Value,>({ ref, ...props }: OptionCardProps<Value>) => {
  const {
    icon,
    className,
    title,
    description,
    isActive,
    children,
    actions,
    activeHeaderClassName,
    style,
    effectImg,
    value,
    noHighlight,
    disabled,
    ...rest
  } = props
  const titleId = useId()
  const descriptionId = useId()
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-xl bg-components-option-card-option-bg shadow-xs',
        isActive && !noHighlight
          ? 'border-[1.5px] border-components-option-card-option-selected-border'
          : 'border border-components-option-card-option-border',
        disabled && 'opacity-50',
        className,
      )}
      style={{
        ...style,
      }}
      {...rest}
      ref={ref}
    >
      <RadioItem<Value>
        value={value}
        nativeButton
        render={<button type="button" />}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex w-full min-w-0 rounded-t-xl border-0 bg-transparent p-0 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
      >
        <OptionCardHeader
          titleId={titleId}
          descriptionId={descriptionId}
          icon={icon}
          title={title}
          description={description}
          isActive={isActive && !noHighlight}
          activeClassName={activeHeaderClassName}
          effectImg={effectImg}
          disabled={disabled}
        />
      </RadioItem>
      {/** Body */}
      {!!(isActive && (children || actions)) && (
        <div
          role="presentation"
          className="rounded-b-xl bg-components-panel-bg px-4 py-3"
          onKeyDown={(event) => {
            // Keep parameter arrow keys from navigating the enclosing radio group.
            if (event.key.startsWith('Arrow')) event.stopPropagation()
          }}
        >
          {children}
          {!!actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
    </div>
  )
}

OptionCard.displayName = 'OptionCard'
