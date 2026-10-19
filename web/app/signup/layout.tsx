import { getRouteMetadata } from '@/app/route-metadata'
import SignupLayout from './signup-layout'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['signup.createAccount'])
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <SignupLayout>{children}</SignupLayout>
}
