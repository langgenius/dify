import { ORPCError } from '@orpc/client'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { getQueryClient } from '@/app/get-query-client'
import { getRouteMetadata } from '@/app/route-metadata'
import {
  redirectForBootstrapError,
  serverUserProfileQueryOptions,
} from '@/features/account-profile/server'
import { resolveServerConsoleApiPrefix } from '@/service/console/server'
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

const handleProfileError = (error: unknown) => {
  if (!(error instanceof ORPCError)) return
  redirectForBootstrapError(error)
  if (error.status !== 401) throw error
}

export default async function SignIn() {
  const queryClient = getQueryClient()

  if (resolveServerConsoleApiPrefix())
    await queryClient.query(serverUserProfileQueryOptions()).catch(handleProfileError)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SignInPage />
    </HydrationBoundary>
  )
}
