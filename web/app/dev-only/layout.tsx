import type React from 'react'
import { notFound } from 'next/navigation'

export default async function Layout({ children }: React.PropsWithChildren) {
  if (process.env.NODE_ENV !== 'development')
    notFound()

  return children
}
