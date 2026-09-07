import type { ReactNode } from 'react'
import { ConsoleRuntimeProviders } from '@/app/(commonLayout)/providers'
import EducationShell from '@/app/education/education-shell'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <ConsoleRuntimeProviders>
      <EducationShell>{children}</EducationShell>
    </ConsoleRuntimeProviders>
  )
}
