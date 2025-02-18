import type { HTMLProps, PropsWithChildren } from 'react'
import classNames from '@/utils/classnames'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'

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
      'flex justify-start items-center gap-2 h-[34px] px-2.5 bg-background-section-burn rounded-lg transition-colors text-text-secondary [&:not(:first-child)]:mt-1',
      disabled ? 'shadow-xs opacity-30 cursor-not-allowed' : 'hover:bg-state-accent-hover hover:text-text-accent cursor-pointer',
      className,
    )}
    {...props}
  >
    <div className='relative h-4 w-4'>{icon}</div>
    <div className='shrink grow basis-0 text-[13px] font-medium leading-[18px]'>{children}</div>
    <ArrowUpRight />
  </a>
)

export default SuggestedAction
