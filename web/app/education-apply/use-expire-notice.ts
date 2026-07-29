'use client'

import type { DismissedEducationExpireNotice, EducationExpireNoticePhase } from './storage'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useDismissedEducationExpireNotice } from './storage'

dayjs.extend(utc)
dayjs.extend(timezone)

export type EducationExpireNotice = {
  accountId: string
  expireAt: number
  expired: boolean
  phase: EducationExpireNoticePhase
}

type ResolveEducationExpireNoticeParams = {
  accountId?: string
  allowRefresh: boolean
  dismissedNotice: DismissedEducationExpireNotice | null
  expireAt: number | null
  isLoading: boolean
  userTimezone?: string
}

const isSameNotice = (
  dismissedNotice: DismissedEducationExpireNotice | null,
  notice: EducationExpireNotice,
) =>
  dismissedNotice?.accountId === notice.accountId &&
  dismissedNotice.expireAt === notice.expireAt &&
  dismissedNotice.phase === notice.phase

export const resolveEducationExpireNotice = ({
  accountId,
  allowRefresh,
  dismissedNotice,
  expireAt,
  isLoading,
  userTimezone,
}: ResolveEducationExpireNoticeParams): EducationExpireNotice | null => {
  if (isLoading || !accountId || !userTimezone || !allowRefresh || expireAt === null) return null

  const today = dayjs().tz(userTimezone).startOf('day')
  const expireDay = dayjs.unix(expireAt).tz(userTimezone).startOf('day')
  const expired = today.isSame(expireDay) || today.isAfter(expireDay)
  const notice: EducationExpireNotice = {
    accountId,
    expireAt,
    expired,
    phase: expired ? 'expired' : 'expiring',
  }

  return isSameNotice(dismissedNotice, notice) ? null : notice
}

export function useEducationExpireNotice() {
  const { data: profile } = useQuery({
    ...userProfileQueryOptions(),
    select: ({ profile }) => ({
      accountId: profile.id,
      timezone: profile.timezone ?? undefined,
    }),
  })
  const { educationAccountExpireAt, allowRefreshEducationVerify, isLoadingEducationAccountInfo } =
    useProviderContext()
  const [dismissedNotice, setDismissedNotice] = useDismissedEducationExpireNotice()
  const notice = resolveEducationExpireNotice({
    accountId: profile?.accountId,
    allowRefresh: allowRefreshEducationVerify,
    dismissedNotice,
    expireAt: educationAccountExpireAt,
    isLoading: isLoadingEducationAccountInfo,
    userTimezone: profile?.timezone,
  })

  const dismissNotice = () => {
    if (!notice) return

    setDismissedNotice({
      accountId: notice.accountId,
      expireAt: notice.expireAt,
      phase: notice.phase,
    })
  }

  return [notice, dismissNotice] as const
}
