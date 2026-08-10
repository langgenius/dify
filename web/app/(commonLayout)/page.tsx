import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { HomePage } from '@/features/home/page'
import { redirect } from '@/next/navigation'

type HomeSearchParams = Record<string, string | string[] | undefined>

type PageProps = {
  searchParams?: Promise<HomeSearchParams>
}

const LEGACY_EDUCATION_VERIFY_ACTION = 'getEducationVerify'
const SETTINGS_QUERY_PARAM_NAME = 'settings'

const getFirstSearchParamValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]

  return value
}

const getEducationVerifyRedirectPath = (searchParams: HomeSearchParams) => {
  const redirectSearchParams = new URLSearchParams({
    [SETTINGS_QUERY_PARAM_NAME]: ACCOUNT_SETTING_TAB.BILLING,
  })

  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === 'action' || key === SETTINGS_QUERY_PARAM_NAME || value === undefined) return

    if (Array.isArray(value)) {
      value.forEach((item) => redirectSearchParams.append(key, item))
      return
    }

    redirectSearchParams.append(key, value)
  })

  return `/?${redirectSearchParams.toString()}`
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const action = getFirstSearchParamValue(resolvedSearchParams.action)

  if (action === LEGACY_EDUCATION_VERIFY_ACTION)
    redirect(getEducationVerifyRedirectPath(resolvedSearchParams))

  return <HomePage />
}
