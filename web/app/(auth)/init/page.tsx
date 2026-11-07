import { getRouteMetadata } from '@/app/route-metadata'
import InitPasswordPopup from './InitPasswordPopup'

export function generateMetadata() {
  return getRouteMetadata('login', ($) => $.adminInitPassword)
}

export default function Init() {
  return <InitPasswordPopup />
}
