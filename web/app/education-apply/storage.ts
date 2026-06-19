import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from './constants'

const [
  useEducationVerifying,
  _useEducationVerifyingValue,
  useSetEducationVerifying,
] = createLocalStorageState<string>(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'no', { raw: true })

const [
  useEducationReverifyPrevExpireAt,
  _useEducationReverifyPrevExpireAtValue,
  useSetEducationReverifyPrevExpireAt,
] = createLocalStorageState<number>('education-reverify-prev-expire-at', 0)

const [
  useEducationReverifyHasNoticed,
  _useEducationReverifyHasNoticedValue,
  useSetEducationReverifyHasNoticed,
] = createLocalStorageState<boolean>('education-reverify-has-noticed', false)

const [
  useEducationExpiredHasNoticed,
  _useEducationExpiredHasNoticedValue,
  useSetEducationExpiredHasNoticed,
] = createLocalStorageState<boolean>('education-expired-has-noticed', false)

export {
  useEducationExpiredHasNoticed,
  useEducationReverifyHasNoticed,
  useEducationReverifyPrevExpireAt,
  useEducationVerifying,
  useSetEducationExpiredHasNoticed,
  useSetEducationReverifyHasNoticed,
  useSetEducationReverifyPrevExpireAt,
  useSetEducationVerifying,
}
