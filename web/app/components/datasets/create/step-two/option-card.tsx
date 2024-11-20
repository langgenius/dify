import { type ComponentProps, type FC, type ReactNode } from 'react'
import Image from 'next/image'
import piggyBank from '../assets/piggy-bank-01.svg'
import classNames from '@/utils/classnames'

const TriangleArrow = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="11" viewBox="0 0 24 11" fill="none">
    <path d="M9.87868 1.12132C11.0503 -0.0502525 12.9497 -0.0502525 14.1213 1.12132L23.3137 10.3137H0.686292L9.87868 1.12132Z" fill="white"/>
  </svg>
)

type OptionCardHeaderProps = {
  icon: ReactNode
  title: ReactNode
  description: string
  isActive?: boolean
  activeClassName?: string
}

export const OptionCardHeader: FC<OptionCardHeaderProps> = (props) => {
  const { icon, title, description, isActive, activeClassName } = props
  return <div className={classNames(
    'h-20 flex py-3 px-4 items-center gap-4',
    isActive && activeClassName,
  )}>
    <div className='size-8 rounded-lg border p-1.5 shadow border-[#101828]/10 justify-center flex'>
      {icon || <Image src={piggyBank.src} className='size-5' alt={description} width={20} height={20} />}
    </div>
    <div className='flex-1 space-y-1'>
      <div className='text-[#354052] text-sm font-semibold leading-tight'>{title}</div>
      <div className='text-[#676f83] text-xs font-normal leading-none'>{description}</div>
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
} & Omit<ComponentProps<'div'>, 'title'>

export const OptionCard: FC<OptionCardProps> = (props) => {
  const { icon, className, title, description, isActive, children, actions, activeHeaderClassName, style, ...rest } = props
  return <div
    className={classNames(
      'rounded-xl overflow-hidden',
      isActive ? 'border-[#296cff] bg-white' : 'border-[#e9ebf0] bg-[#FCFCFD]',
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
    />
    {/** Body */}
    {isActive && <div className='p-3'>{children}
      {actions && <div className='flex gap-2 mt-3'>
        {actions}
      </div>}
    </div>}
  </div>
}
