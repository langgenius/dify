import { type ComponentProps, type FC, type ReactNode, forwardRef } from 'react'
import Image from 'next/image'
import Effect from '../assets/option-card-effect-blue.svg'
import classNames from '@/utils/classnames'

const TriangleArrow: FC<ComponentProps<'svg'>> = props => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="11" viewBox="0 0 24 11" fill="none" {...props}>
    <path d="M9.87868 1.12132C11.0503 -0.0502525 12.9497 -0.0502525 14.1213 1.12132L23.3137 10.3137H0.686292L9.87868 1.12132Z" fill="currentColor"/>
  </svg>
)

type OptionCardHeaderProps = {
  icon: ReactNode
  title: ReactNode
  description: string
  isActive?: boolean
  activeClassName?: string
  effectImg?: string
}

export const OptionCardHeader: FC<OptionCardHeaderProps> = (props) => {
  const { icon, title, description, isActive, activeClassName, effectImg } = props
  return <div className={classNames(
    'flex h-full overflow-hidden rounded-t-xl relative',
    isActive && activeClassName,
  )}>
    <div className='size-14 flex items-center justify-center relative overflow-hidden'>
      {isActive && <Image src={effectImg || Effect.src} className='absolute top-0 left-0 w-full h-full' alt='' width={56} height={56} />}
      <div className='size-8 rounded-lg border p-1.5 shadow border-components-panel-border-subtle justify-center flex bg-background-default-dodge'>
        {icon}
      </div>
    </div>
    <TriangleArrow
      className='absolute left-4 -bottom-1.5 text-components-panel-bg'
    />
    <div className='flex-1 space-y-1 py-3 pr-4'>
      <div className='text-text-secondary text-sm font-semibold leading-tight'>{title}</div>
      <div className='text-text-tertiary text-xs font-normal leading-none'>{description}</div>
    </div>
  </div>
}

type OptionCardProps = {
  icon: ReactNode
  className?: string
  activeHeaderClassName?: string
  title: ReactNode
  description: string
  isActive?: boolean
  actions?: ReactNode
  effectImg?: string
  onSwitched?: () => void
  noHighlight?: boolean
  disabled?: boolean
} & Omit<ComponentProps<'div'>, 'title'>

export const OptionCard: FC<OptionCardProps> = forwardRef((props, ref) => {
  const { icon, className, title, description, isActive, children, actions, activeHeaderClassName, style, effectImg, onSwitched, onClick, noHighlight, disabled, ...rest } = props
  return <div
    className={classNames(
      'rounded-xl border',
      (isActive && !noHighlight)
        ? 'border-components-option-card-option-selected-border bg-components-panel-bg'
        : 'border-components-option-card-option-border bg-components-option-card-option-bg',
      disabled && 'opacity-50',
      className,
    )}
    style={{
      ...style,
      borderWidth: 1.5,
    }}
    onClick={(e) => {
      if (!isActive)
        onSwitched?.()
      onClick?.(e)
    }}
    {...rest}
    ref={ref}
  >
    <OptionCardHeader
      icon={icon}
      title={title}
      description={description}
      isActive={isActive && !noHighlight}
      activeClassName={activeHeaderClassName}
      effectImg={effectImg}
    />
    {/** Body */}
    {isActive && (children || actions) && <div className='p-3'>
      {children}
      {actions && <div className='flex gap-2 mt-4'>
        {actions}
      </div>
      }
    </div>}
  </div>
})

OptionCard.displayName = 'OptionCard'
