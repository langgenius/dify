import Account from '@/app/components/end-user/account'
import { getRouteMetadata } from '@/app/route-metadata'

export async function generateMetadata() {
  return getRouteMetadata('accountSettings', ($) => $['account.myAccount'])
}

export default function Page() {
  return <Account />
}
