import type { SearchParams } from '@/utils/search-params'
import { redirect } from 'next/navigation'
import { searchParamsToString } from '@/utils/search-params'

const Login = ({ searchParams }: { searchParams?: SearchParams }) => {
  redirect(`/signin${searchParamsToString(searchParams || {})}`)
}

export default Login
