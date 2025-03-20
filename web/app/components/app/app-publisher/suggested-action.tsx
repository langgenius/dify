import type { HTMLProps, PropsWithChildren } from 'react'
import { RiArrowRightUpLine } from '@remixicon/react'
import classNames from '@/utils/classnames'

export type SuggestedActionProps = PropsWithChildren<HTMLProps<HTMLAnchorElement> & {
  icon?: React.ReactNode
  link?: string
  disabled?: boolean
}>

const SuggestedAction = ({ icon, link, disabled, children, className, ...props }: SuggestedActionProps) => (
  <a
    href={disabled ? undefined : link}
    target='_blank'
    rel='noreferrer'
    className={classNames(
      'flex justify-start items-center gap-2 py-2 px-2.5 bg-background-section-burn rounded-lg transition-colors [&:not(:first-child)]:mt-1',
      disabled ? 'shadow-xs opacity-30 cursor-not-allowed' : 'text-text-secondary hover:bg-state-accent-hover hover:text-text-accent cursor-pointer',
      className,
    )}
    {...props}
  >
    <div className='relative w-4 h-4'>{icon}</div>
    <div className='grow shrink basis-0 system-sm-medium'>{children}</div>
    <RiArrowRightUpLine className='w-3.5 h-3.5' />
  </a>
)

export default SuggestedAction
