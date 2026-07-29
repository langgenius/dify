import { createLocalStorageState } from 'foxact/create-local-storage-state'

export type EducationExpireNoticePhase = 'expiring' | 'expired'

export type DismissedEducationExpireNotice = {
  accountId: string
  expireAt: number
  phase: EducationExpireNoticePhase
}

const [useDismissedEducationExpireNotice] =
  createLocalStorageState<DismissedEducationExpireNotice | null>(
    'dismissed-education-expire-notice',
    null,
  )

export { useDismissedEducationExpireNotice }
