import MyAppsDemo from '@/app/components/end-user/my-apps/demo'
import { getRouteMetadata } from '@/app/route-metadata'

export function generateMetadata() {
  return getRouteMetadata('app', ($) => $['endUser.myApps'])
}

export default function Page() {
  return <MyAppsDemo />
}
