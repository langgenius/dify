'use client'

import type { PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthShell } from '@/app/components/auth-shell'
import useDocumentTitle from '@/hooks/use-document-title'

export default function WebappSignInLayout({ children }: PropsWithChildren) {
  const { t } = useTranslation(['login'])
  useDocumentTitle(t(($) => $['webapp.login'], { ns: 'login' }))

  return (
    <AuthShell header={false} wide>
      {children}
    </AuthShell>
  )
}
