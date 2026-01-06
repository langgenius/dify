import { use } from 'react'
import { getLocaleOnServer } from './server'

export function useLocale() {
  return use(getLocaleOnServer())
}
