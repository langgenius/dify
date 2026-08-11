import type { ReactNode } from 'react'
import EducationLayout from '@/app/education/education-shell'

export default function Layout({ children }: { children: ReactNode }) {
  return <EducationLayout>{children}</EducationLayout>
}
