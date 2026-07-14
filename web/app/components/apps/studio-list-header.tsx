import type { ReactNode } from 'react'

type StudioListHeaderProps = {
  title: ReactNode
  children: ReactNode
}

export function StudioListHeader({ title, children }: StudioListHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-[14px] bg-background-body px-8 pt-4 pb-2">
      <div className="flex h-6 min-w-0 items-center">{title}</div>
      {children}
    </div>
  )
}
