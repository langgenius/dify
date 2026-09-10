import { getRouteMetadata } from '@/app/route-metadata'
import ResetPasswordLayout from './reset-password-layout'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.resetPassword)
}

export default function SignInLayout({ children }: any) {
  return <ResetPasswordLayout>{children}</ResetPasswordLayout>
}
