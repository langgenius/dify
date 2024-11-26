import { type ComponentProps, type FC, type ReactNode } from 'react'
import Image from 'next/image'
import piggyBank from '../assets/piggy-bank-01.svg'
import Effect from '../assets/option-card-effect-blue.svg'
import classNames from '@/utils/classnames'

const TriangleArrow: FC<ComponentProps<'svg'>> = props => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="11" viewBox="0 0 24 11" fill="none" {...props}>
    <path d="M9.87868 1.12132C11.0503 -0.0502525 12.9497 -0.0502525 14.1213 1.12132L23.3137 10.3137H0.686292L9.87868 1.12132Z" fill="white"/>
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
    'flex h-full overflow-hidden relative',
    isActive && activeClassName,
  )}>
    <div className='size-14 flex items-center justify-center relative overflow-hidden'>
      {isActive && <Image src={effectImg || Effect.src} className='absolute top-0 left-0 w-full h-full' alt='' width={56} height={56} />}
      <div className='size-8 rounded-lg border p-1.5 shadow border-components-panel-border-subtle justify-center flex bg-white'>
        {icon || <Image src={piggyBank.src} className='size-5' alt={description} width={20} height={20} />}
      </div>
    </div>
    <TriangleArrow
      className='absolute left-4 -bottom-1.5'
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
} & Omit<ComponentProps<'div'>, 'title'>

export const OptionCard: FC<OptionCardProps> = (props) => {
  const { icon, className, title, description, isActive, children, actions, activeHeaderClassName, style, effectImg, ...rest } = props
  return <div
    className={classNames(
      'rounded-xl overflow-hidden',
      isActive ? 'border-components-option-card-option-selected-border bg-components-panel-bg' : 'border-components-option-card-option-border bg-components-option-card-option-bg',
      className,
    )}
    style={{
      ...style,
      borderWidth: 1.5,
    }}
    {...rest}>
    <OptionCardHeader
      icon={icon}
      title={title}
      description={description}
      isActive={isActive}
      activeClassName={activeHeaderClassName}
      effectImg={effectImg}
    />
    {/** Body */}
    {isActive && <div className='p-3'>{children}
      {actions && <div className='flex gap-2 mt-4'>
        {actions}
      </div>}
    </div>}
  </div>
}
