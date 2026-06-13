import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'

export const [
  useEducationVerifying,
  useEducationVerifyingValue,
  useSetEducationVerifying,
] = createLocalStorageState<string>(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'no', { raw: true })

export const [
  useEducationReverifyPrevExpireAt,
  useEducationReverifyPrevExpireAtValue,
  useSetEducationReverifyPrevExpireAt,
] = createLocalStorageState<number>('education-reverify-prev-expire-at', 0)

export const [
  useEducationReverifyHasNoticed,
  useEducationReverifyHasNoticedValue,
  useSetEducationReverifyHasNoticed,
] = createLocalStorageState<boolean>('education-reverify-has-noticed', false)

export const [
  useEducationExpiredHasNoticed,
  useEducationExpiredHasNoticedValue,
  useSetEducationExpiredHasNoticed,
] = createLocalStorageState<boolean>('education-expired-has-noticed', false)
