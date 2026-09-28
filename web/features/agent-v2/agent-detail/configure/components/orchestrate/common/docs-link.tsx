import type { ReactNode } from 'react'

export function DocsLink({ children, href }: { children?: ReactNode; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-accent hover:underline"
    >
      {children}
    </a>
  )
}
