import type { SearchParams } from './types'
import { useQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useCallback, useEffect, useState } from 'react'
import {
  useEducationExpiredHasNoticed,
  useEducationReverifyHasNoticed,
  useEducationReverifyPrevExpireAt,
} from '@/app/education-apply/storage'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useEducationAutocomplete } from '@/service/use-education'

dayjs.extend(utc)
dayjs.extend(timezone)
export const useEducation = () => {
  const { mutateAsync, isPending, data } = useEducationAutocomplete()

  const [prevSchools, setPrevSchools] = useState<string[]>([])
  const handleUpdateSchools = useCallback(
    (searchParams: SearchParams) => {
      if (searchParams.keywords) {
        mutateAsync(searchParams).then((res) => {
          const currentPage = searchParams.page || 0
          const resSchools = res.data
          if (currentPage > 0)
            setPrevSchools((prevSchools) => [...(prevSchools || []), ...resSchools])
          else setPrevSchools(resSchools)
        })
      }
    },
    [mutateAsync],
  )

  const { run: querySchoolsWithDebounced } = useDebounceFn(
    (searchParams: SearchParams) => {
      handleUpdateSchools(searchParams)
    },
    {
      wait: 300,
    },
  )

  return {
    schools: prevSchools,
    setSchools: setPrevSchools,
    querySchoolsWithDebounced,
    handleUpdateSchools,
    isLoading: isPending,
    hasNext: data?.has_next,
  }
}

type useEducationReverifyNoticeParams = {
  onNotice: ({ expireAt, expired }: { expireAt: number; expired: boolean }) => void
}

const isExpired = (expireAt?: number, timezone?: string) => {
  if (!expireAt || !timezone) return false
  const today = dayjs().tz(timezone).startOf('day')
  const expiredDay = dayjs.unix(expireAt).tz(timezone).startOf('day')
  return today.isSame(expiredDay) || today.isAfter(expiredDay)
}

const useEducationReverifyNotice = ({ onNotice }: useEducationReverifyNoticeParams) => {
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone ?? undefined,
  })
  // const [educationInfo, setEducationInfo] = useState<{ is_student: boolean, allow_refresh: boolean, expire_at: number | null } | null>(null)
  // const isLoading = !educationInfo
  const {
    educationAccountExpireAt,
    allowRefreshEducationVerify,
    isLoadingEducationAccountInfo: isLoading,
  } = useProviderContext()
  const [prevExpireAt, setPrevExpireAt] = useEducationReverifyPrevExpireAt()
  const [reverifyHasNoticed, setReverifyHasNoticed] = useEducationReverifyHasNoticed()
  const [expiredHasNoticed, setExpiredHasNoticed] = useEducationExpiredHasNoticed()

  useEffect(() => {
    if (isLoading || !timezone) return
    if (allowRefreshEducationVerify) {
      const expired = isExpired(educationAccountExpireAt!, timezone)
      const isExpireAtChanged = prevExpireAt !== educationAccountExpireAt
      if (isExpireAtChanged) {
        setPrevExpireAt(educationAccountExpireAt!)
        setReverifyHasNoticed(false)
        setExpiredHasNoticed(false)
      }
      const shouldNotice = (() => {
        if (isExpireAtChanged) return true
        return expired ? !expiredHasNoticed : !reverifyHasNoticed
      })()
      if (shouldNotice) {
        onNotice({
          expireAt: educationAccountExpireAt!,
          expired,
        })
        if (expired) setExpiredHasNoticed(true)
        else setReverifyHasNoticed(true)
      }
    }
  }, [allowRefreshEducationVerify, timezone])

  return {
    isLoading,
    expireAt: educationAccountExpireAt!,
    expired: isExpired(educationAccountExpireAt!, timezone),
  }
}

export const useEducationInit = () => {
  const setShowEducationExpireNoticeModal = useModalContextSelector(
    (s) => s.setShowEducationExpireNoticeModal,
  )

  useEducationReverifyNotice({
    onNotice: (payload) => {
      setShowEducationExpireNoticeModal({ payload })
    },
  })
}
