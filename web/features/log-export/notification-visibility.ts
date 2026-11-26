'use client'

import { atom, useAtomValue, useSetAtom } from 'jotai'
import {
  atomWithStorage,
  createJSONStorage,
  unstable_withStorageValidator as withStorageValidator,
} from 'jotai/utils'
import { useEffect, useLayoutEffect } from 'react'

const openProgressTaskIdAtom = atom<string | null>(null)
const readyTaskIdsStorage = withStorageValidator(
  (value): value is string[] => Array.isArray(value) && value.every((id) => typeof id === 'string'),
)(createJSONStorage<unknown>(() => window.sessionStorage))
const seenReadyTaskIdsAtom = atomWithStorage<string[]>(
  'dify-log-export-seen-ready-tasks',
  [],
  readyTaskIdsStorage,
  { getOnInit: true },
)
const hiddenNotificationTaskIdsAtom = atom((get) => {
  const openTaskId = get(openProgressTaskIdAtom)
  const seenTaskIds = get(seenReadyTaskIdsAtom)
  return new Set(openTaskId ? [...seenTaskIds, openTaskId] : seenTaskIds)
})

export function useHiddenLogExportNotificationTaskIds() {
  return useAtomValue(hiddenNotificationTaskIdsAtom)
}

export function useObserveLogExportProgress(taskId: string | null, ready: boolean) {
  const setOpenTaskId = useSetAtom(openProgressTaskIdAtom)
  const setSeenReadyTaskIds = useSetAtom(seenReadyTaskIdsAtom)

  useLayoutEffect(() => {
    if (!taskId) return
    setOpenTaskId(taskId)
    return () => setOpenTaskId((current) => (current === taskId ? null : current))
  }, [taskId, setOpenTaskId])

  useEffect(() => {
    if (!taskId || !ready) return
    const markReadySeen = () => {
      if (document.visibilityState === 'visible')
        setSeenReadyTaskIds((ids) => (ids.includes(taskId) ? ids : [...ids, taskId]))
    }
    markReadySeen()
    document.addEventListener('visibilitychange', markReadySeen)
    return () => document.removeEventListener('visibilitychange', markReadySeen)
  }, [taskId, ready, setSeenReadyTaskIds])
}
