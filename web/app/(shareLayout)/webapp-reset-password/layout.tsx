/* oxlint-disable react/only-export-components -- Next.js requires metadata and layout exports in the route file. */
import { getRouteMetadata } from '@/app/route-metadata'
import ResetPasswordLayout from './reset-password-layout'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.resetPassword)
}

export default function SignInLayout({ children }: any) {
  return <ResetPasswordLayout>{children}</ResetPasswordLayout>
}
