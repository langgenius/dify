import { getRouteMetadata } from '@/app/route-metadata'
import SignInPage from './sign-in-page'

type SignInPageProps = {
  searchParams: Promise<{ step?: string | string[] }>
}

export async function generateMetadata({ searchParams }: SignInPageProps) {
  const { step: stepParam } = await searchParams
  const step = Array.isArray(stepParam) ? stepParam[0] : stepParam

  return step === 'next'
    ? getRouteMetadata('login', ($) => $.oneMoreStep)
    : getRouteMetadata('login', ($) => $.signBtn)
}

export default function SignIn() {
  return <SignInPage />
}
