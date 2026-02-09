import type { FC, PropsWithChildren } from 'react'
import * as React from 'react'

type ContentAreaProps = PropsWithChildren

const ContentArea: FC<ContentAreaProps> = ({ children }) => {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg">
      {children}
    </section>
  )
}

export default React.memo(ContentArea)
