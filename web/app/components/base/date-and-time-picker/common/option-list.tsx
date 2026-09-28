import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type OptionListProps = {
  children: ReactNode
} & HTMLAttributes<HTMLUListElement>

const optionListClassName = cn(
  'flex h-52 flex-col gap-y-0.5 overflow-y-auto pb-46',
  'scrollbar-none [&::-webkit-scrollbar]:hidden',
)

const OptionList = ({ children, className, ...props }: OptionListProps) => {
  return (
    <ul className={cn(optionListClassName, className)} {...props}>
      {children}
    </ul>
  )
}

export default React.memo(OptionList)
