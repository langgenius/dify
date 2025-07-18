import type { HTMLProps, PropsWithChildren } from 'react'
import { RiArrowRightUpLine } from '@remixicon/react'
import classNames from '@/utils/classnames'

export type SuggestedActionProps = PropsWithChildren<HTMLProps<HTMLAnchorElement> & {
  icon?: React.ReactNode
  link?: string
  disabled?: boolean
}>

const SuggestedAction = ({ icon, link, disabled, children, className, onClick, ...props }: SuggestedActionProps) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled)
      return
    onClick?.(e)
  }
  return (
    <a
      href={disabled ? undefined : link}
      target='_blank'
      rel='noreferrer'
      className={classNames(
        'flex items-center justify-start gap-2 rounded-lg bg-background-section-burn px-2.5 py-2 text-text-secondary transition-colors [&:not(:first-child)]:mt-1',
        disabled ? 'cursor-not-allowed opacity-30 shadow-xs' : 'cursor-pointer text-text-secondary hover:bg-state-accent-hover hover:text-text-accent',
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      <div className='relative h-4 w-4'>{icon}</div>
      <div className='system-sm-medium shrink grow basis-0'>{children}</div>
      <RiArrowRightUpLine className='h-3.5 w-3.5' />
    </a>
  )
}

export default SuggestedAction
