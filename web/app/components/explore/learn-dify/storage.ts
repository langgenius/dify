'use client'

import { useLocalStorageState } from 'ahooks'
import { useCallback, useEffect } from 'react'

export const LEARN_DIFY_HIDDEN_STORAGE_KEY = 'explore-learn-dify-hidden'
export const LEARN_DIFY_VISIBILITY_CHANGE_EVENT = 'explore-learn-dify-visibility-change'

type LearnDifyVisibilityChangeEvent = CustomEvent<{ hidden: boolean }>

export const dispatchLearnDifyVisibilityChange = (hidden: boolean) => {
  window.dispatchEvent(new CustomEvent(LEARN_DIFY_VISIBILITY_CHANGE_EVENT, {
    detail: { hidden },
  }))
}

export const useLearnDifyHiddenState = () => {
  const [rawHidden, setRawHidden] = useLocalStorageState<boolean>(LEARN_DIFY_HIDDEN_STORAGE_KEY, {
    defaultValue: false,
  })

  useEffect(() => {
    const handleVisibilityChange = (event: Event) => {
      setRawHidden((event as LearnDifyVisibilityChangeEvent).detail.hidden)
    }

    window.addEventListener(LEARN_DIFY_VISIBILITY_CHANGE_EVENT, handleVisibilityChange)
    return () => {
      window.removeEventListener(LEARN_DIFY_VISIBILITY_CHANGE_EVENT, handleVisibilityChange)
    }
  }, [setRawHidden])

  const setHidden = useCallback((nextHidden: boolean) => {
    setRawHidden(nextHidden)
    dispatchLearnDifyVisibilityChange(nextHidden)
  }, [setRawHidden])

  return [rawHidden ?? false, setHidden] as const
}
