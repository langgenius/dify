import type { ReactNode } from 'react'
import { OAuthRegistrationAnalytics } from '@/app/components/oauth-registration-analytics'

export default function OAuthAuthorizeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OAuthRegistrationAnalytics />
      {children}
    </>
  )
}
