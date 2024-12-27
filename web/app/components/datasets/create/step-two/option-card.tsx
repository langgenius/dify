import { type ComponentProps, type FC, type ReactNode, forwardRef } from 'react'
import Image from 'next/image'
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
  disabled?: boolean
}

export const OptionCardHeader: FC<OptionCardHeaderProps> = (props) => {
  const { icon, title, description, isActive, activeClassName, effectImg, disabled } = props
  return <div className={classNames(
    'flex h-full overflow-hidden rounded-t-xl relative',
    isActive && activeClassName,
    !disabled && 'cursor-pointer',
  )}>
    <div className='size-14 flex items-center justify-center relative overflow-hidden'>
      {isActive && effectImg && <Image src={effectImg} className='absolute top-0 left-0 w-full h-full' alt='' width={56} height={56} />}
      <div className='p-1'>
        <div className='size-8 rounded-lg border p-1.5 shadow-md border-components-panel-border-subtle justify-center flex bg-background-default-dodge'>
          {icon}
        </div>
      </div>
    </div>
    <TriangleArrow
      className='absolute left-4 -bottom-1.5 text-components-panel-bg'
    />
    <div className='flex-1 space-y-0.5 py-3 pr-4'>
      <div className='text-text-secondary system-md-semibold'>{title}</div>
      <div className='text-text-tertiary system-xs-regular'>{description}</div>
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
} & Omit<ComponentProps<'div'>, 'title' | 'onClick'>

export const OptionCard: FC<OptionCardProps> = forwardRef((props, ref) => {
  const { icon, className, title, description, isActive, children, actions, activeHeaderClassName, style, effectImg, onSwitched, noHighlight, disabled, ...rest } = props
  return <div
    className={classNames(
      'rounded-xl bg-components-option-card-option-bg shadow-xs',
      (isActive && !noHighlight)
        ? 'border-[1.5px] border-components-option-card-option-selected-border'
        : 'border border-components-option-card-option-border',
      disabled && 'opacity-50 cursor-not-allowed',
      className,
    )}
    style={{
      ...style,
    }}
    onClick={() => {
      if (!isActive && !disabled)
        onSwitched?.()
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
      disabled={disabled}
    />
    {/** Body */}
    {isActive && (children || actions) && <div className='py-3 px-4 bg-components-panel-bg rounded-b-xl'>
      {children}
      {actions && <div className='flex gap-2 mt-4'>
        {actions}
      </div>
      }
    </div>}
  </div>
})

OptionCard.displayName = 'OptionCard'
