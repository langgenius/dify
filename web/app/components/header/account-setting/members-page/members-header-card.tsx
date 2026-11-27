import type { ReactNode } from 'react'

export const MembersHeaderCard = ({ children }: { children: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border-s-[0.5px] border-t-[0.5px] border-divider-subtle bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 py-2 ps-2 pe-5 rtl:bg-linear-to-l">
    {children}
  </div>
)
