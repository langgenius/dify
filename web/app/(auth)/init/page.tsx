import { getRouteMetadata } from '@/app/route-metadata'
import InitPasswordPopup from './InitPasswordPopup'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.adminInitPassword)
}

const Init = () => {
  return <InitPasswordPopup />
}

export default Init
