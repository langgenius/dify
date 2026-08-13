/* oxlint-disable react/only-export-components -- Next.js requires metadata and layout exports in the route file. */
import { getRouteMetadata } from '@/app/route-metadata'
import SignupLayout from './signup-layout'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $['signup.createAccount'])
}

export default function RegisterLayout({ children }: any) {
  return <SignupLayout>{children}</SignupLayout>
}
