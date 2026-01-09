import type { SearchParams } from './types'
import { useDebounceFn, useLocalStorageState } from 'ahooks'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useAppContext } from '@/context/app-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useEducationAutocomplete, useEducationVerify } from '@/service/use-education'
import {
  EDUCATION_RE_VERIFY_ACTION,
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from './constants'

dayjs.extend(utc)
dayjs.extend(timezone)
export const useEducation = () => {
  const {
    mutateAsync,
    isPending,
    data,
  } = useEducationAutocomplete()

  const [prevSchools, setPrevSchools] = useState<string[]>([])
  const handleUpdateSchools = useCallback((searchParams: SearchParams) => {
    if (searchParams.keywords) {
      mutateAsync(searchParams).then((res) => {
        const currentPage = searchParams.page || 0
        const resSchools = res.data
        if (currentPage > 0)
          setPrevSchools(prevSchools => [...(prevSchools || []), ...resSchools])
        else
          setPrevSchools(resSchools)
      })
    }
  }, [mutateAsync])

  const { run: querySchoolsWithDebounced } = useDebounceFn((searchParams: SearchParams) => {
    handleUpdateSchools(searchParams)
  }, {
    wait: 300,
  })

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
  onNotice: ({
    expireAt,
    expired,
  }: {
    expireAt: number
    expired: boolean
  }) => void
}

const isExpired = (expireAt?: number, timezone?: string) => {
  if (!expireAt || !timezone)
    return false
  const today = dayjs().tz(timezone).startOf('day')
  const expiredDay = dayjs.unix(expireAt).tz(timezone).startOf('day')
  return today.isSame(expiredDay) || today.isAfter(expiredDay)
}

const useEducationReverifyNotice = ({
  onNotice,
}: useEducationReverifyNoticeParams) => {
  const { userProfile: { timezone } } = useAppContext()
  // const [educationInfo, setEducationInfo] = useState<{ is_student: boolean, allow_refresh: boolean, expire_at: number | null } | null>(null)
  // const isLoading = !educationInfo
  const { educationAccountExpireAt, allowRefreshEducationVerify, isLoadingEducationAccountInfo: isLoading } = useProviderContext()
  const [prevExpireAt, setPrevExpireAt] = useLocalStorageState<number | undefined>('education-reverify-prev-expire-at', {
    defaultValue: 0,
  })
  const [reverifyHasNoticed, setReverifyHasNoticed] = useLocalStorageState<boolean | undefined>('education-reverify-has-noticed', {
    defaultValue: false,
  })
  const [expiredHasNoticed, setExpiredHasNoticed] = useLocalStorageState<boolean | undefined>('education-expired-has-noticed', {
    defaultValue: false,
  })

  useEffect(() => {
    if (isLoading || !timezone)
      return
    if (allowRefreshEducationVerify) {
      const expired = isExpired(educationAccountExpireAt!, timezone)
      const isExpireAtChanged = prevExpireAt !== educationAccountExpireAt
      if (isExpireAtChanged) {
        setPrevExpireAt(educationAccountExpireAt!)
        setReverifyHasNoticed(false)
        setExpiredHasNoticed(false)
      }
      const shouldNotice = (() => {
        if (isExpireAtChanged)
          return true
        return expired ? !expiredHasNoticed : !reverifyHasNoticed
      })()
      if (shouldNotice) {
        onNotice({
          expireAt: educationAccountExpireAt!,
          expired,
        })
        if (expired)
          setExpiredHasNoticed(true)
        else
          setReverifyHasNoticed(true)
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
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const setShowEducationExpireNoticeModal = useModalContextSelector(s => s.setShowEducationExpireNoticeModal)
  const educationVerifying = localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
  const searchParams = useSearchParams()
  const educationVerifyAction = searchParams.get('action')

  useEducationReverifyNotice({
    onNotice: (payload) => {
      setShowEducationExpireNoticeModal({ payload })
    },
  })

  const router = useRouter()
  const { mutateAsync } = useEducationVerify()
  const handleVerify = async () => {
    const { token } = await mutateAsync()
    if (token)
      router.push(`/education-apply?token=${token}`)
  }

  useEffect(() => {
    if (educationVerifying === 'yes' || educationVerifyAction === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION) {
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })

      if (educationVerifyAction === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
        localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')
    }
    if (educationVerifyAction === EDUCATION_RE_VERIFY_ACTION)
      handleVerify()
  }, [setShowAccountSettingModal, educationVerifying, educationVerifyAction])
}
