import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useDebounceFn } from 'ahooks'
import { useSearchParams } from 'next/navigation'
import type { SearchParams } from './types'
import {
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
} from './constants'
import { useEducationAutocomplete, useEducationExpireAt } from '@/service/use-education'
import { useModalContextSelector } from '@/context/modal-context'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { useAppContext } from '@/context/app-context'

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
  if(!expireAt || !timezone)
    return false
  const today = dayjs().tz(timezone).startOf('day')
  const expiredDay = dayjs.unix(expireAt).tz(timezone).startOf('day')
  return today.isSame(expiredDay) || today.isAfter(expiredDay)
}
export const useEducationReverifyNotice = ({
  onNotice,
}: useEducationReverifyNoticeParams) => {
  // const [hasNoticed, setHasNoticed] = useLocalStorageState<boolean | undefined>('education-reverify-has-noticed', {
  //   defaultValue: false,
  // })
  const [hasNoticed, setHasNoticed] = useState<boolean | undefined>(false) // For testing purposes, we set it to false
  const { userProfile: { timezone } } = useAppContext()
  const {
    data,
    isLoading,
  } = useEducationExpireAt()

  useEffect(() => {
    if(isLoading || !data || !timezone)
      return
    const { expireAt, shouldNotice } = data
    if(shouldNotice && !hasNoticed) {
        setHasNoticed(true)
        onNotice({
          expireAt,
          expired: isExpired(expireAt, timezone),
        })
    }
  }, [data, timezone])

  return {
    isLoading,
    expireAt: data?.expireAt,
    expired: isExpired(data?.expireAt, timezone),
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

  useEffect(() => {
    if (educationVerifying === 'yes' || educationVerifyAction === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION) {
      setShowAccountSettingModal({ payload: 'billing' })

      if (educationVerifyAction === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
        localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')
    }
  }, [setShowAccountSettingModal, educationVerifying, educationVerifyAction])
}
