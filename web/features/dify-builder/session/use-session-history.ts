'use client'

import type { ConversationItem } from '../types'
import type { SessionControllerContext } from './controller-types'
import { useSetAtom, useStore } from 'jotai'
import { useCallback } from 'react'
import { getSessionConversation } from './client'
import { requestErrorMessage } from './errors'
import { hasConversationRange, mergeConversation, mergeConversationPage } from './projection'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from './state'

export function useDifyBuilderSessionHistory({
  abortRef,
  runEvents,
}: Pick<SessionControllerContext, 'abortRef' | 'runEvents'>) {
  const store = useStore()

  const setConversation = useSetAtom(difyBuilderConversationAtom)

  const setConversationHasMore = useSetAtom(difyBuilderConversationHasMoreAtom)

  const setConversationLoading = useSetAtom(difyBuilderConversationLoadingAtom)

  const setLocalUserMessage = useSetAtom(difyBuilderLocalUserMessageAtom)

  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)

  const confirmLocalUserMessage = useCallback(
    (sessionId: string, items: ConversationItem[]) => {
      setLocalUserMessage((current) => {
        if (!current || current.sessionId !== sessionId) return current
        return items.some(
          (item) =>
            item.kind === 'user' &&
            (current.turnId
              ? item.payload.turn_id === current.turnId
              : item.payload.text === current.text),
        )
          ? null
          : current
      })
    },
    [setLocalUserMessage],
  )

  const syncConversation = useCallback(
    async (
      sessionId: string,
      targetLastSeq: number,
      controller: AbortController,
      replaceWithLatest = false,
    ) => {
      if (store.get(difyBuilderSessionViewAtom)?.conversation_cleared) return true
      let items =
        replaceWithLatest || store.get(difyBuilderSessionViewAtom)?.session_id !== sessionId
          ? []
          : store.get(difyBuilderConversationAtom)

      if (replaceWithLatest || items.length === 0) {
        const page = await getSessionConversation(
          sessionId,
          { before_seq: targetLastSeq + 1, limit: 20 },
          controller.signal,
        )
        if (
          controller.signal.aborted ||
          store.get(difyBuilderActiveSessionIdAtom) !== sessionId ||
          store.get(difyBuilderSessionViewAtom)?.conversation_cleared
        )
          return false
        const pageItems = page.data.filter((item) => item.seq <= targetLastSeq)
        items = mergeConversationPage(store.get(difyBuilderConversationAtom), pageItems)
        setConversation(items)
        confirmLocalUserMessage(sessionId, items)
        setConversationHasMore(page.has_more)
      }

      let lastSeq = items.at(-1)?.seq ?? -1
      while (lastSeq < targetLastSeq) {
        const page = await getSessionConversation(
          sessionId,
          { after_seq: lastSeq, limit: 100 },
          controller.signal,
        )
        if (
          controller.signal.aborted ||
          store.get(difyBuilderActiveSessionIdAtom) !== sessionId ||
          store.get(difyBuilderSessionViewAtom)?.conversation_cleared
        )
          return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversationPage(store.get(difyBuilderConversationAtom), boundedPage)
        const nextLastSeq = merged.at(-1)?.seq ?? -1
        if (nextLastSeq <= lastSeq) return false
        items = merged
        lastSeq = nextLastSeq
        setConversation(items)
        confirmLocalUserMessage(sessionId, boundedPage)
        if (!page.has_more) break
      }
      if (lastSeq >= targetLastSeq) runEvents?.restoreRun(sessionId, items)
      return lastSeq >= targetLastSeq
    },
    [confirmLocalUserMessage, runEvents, setConversation, setConversationHasMore, store],
  )

  const syncConversationRange = useCallback(
    async (
      sessionId: string,
      afterSequence: number,
      targetLastSeq: number,
      controller: AbortController,
    ) => {
      let items = store.get(difyBuilderConversationAtom)
      let cursor = afterSequence

      while (cursor < targetLastSeq) {
        const sequences = new Set(items.map((item) => item.seq))
        while (cursor < targetLastSeq && sequences.has(cursor + 1)) cursor += 1
        if (cursor >= targetLastSeq) break

        const page = await getSessionConversation(
          sessionId,
          { after_seq: cursor, limit: 100 },
          controller.signal,
        )
        if (
          controller.signal.aborted ||
          store.get(difyBuilderActiveSessionIdAtom) !== sessionId ||
          store.get(difyBuilderSessionViewAtom)?.conversation_cleared
        )
          return false
        const boundedPage = page.data.filter((item) => item.seq <= targetLastSeq)
        const merged = mergeConversationPage(store.get(difyBuilderConversationAtom), boundedPage)
        const mergedSequences = new Set(merged.map((item) => item.seq))
        let nextCursor = cursor
        while (nextCursor < targetLastSeq && mergedSequences.has(nextCursor + 1)) nextCursor += 1
        if (nextCursor === cursor) return false
        items = merged
        cursor = nextCursor
        setConversation(items)
        confirmLocalUserMessage(sessionId, boundedPage)
      }

      const complete = hasConversationRange(items, afterSequence, targetLastSeq)
      if (complete) runEvents?.restoreRun(sessionId, items)
      return complete
    },
    [confirmLocalUserMessage, runEvents, setConversation, store],
  )

  const loadOlderConversation = useCallback(async () => {
    const view = store.get(difyBuilderSessionViewAtom)
    const items = store.get(difyBuilderConversationAtom)
    const firstItem = items[0]
    if (
      !view ||
      !firstItem ||
      !store.get(difyBuilderConversationHasMoreAtom) ||
      store.get(difyBuilderConversationLoadingAtom) ||
      store.get(difyBuilderSessionBusyAtom)
    )
      return false

    const controller = new AbortController()
    abortRef.current = controller
    setConversationLoading(true)
    try {
      const page = await getSessionConversation(
        view.session_id,
        { before_seq: firstItem.seq, limit: 20 },
        controller.signal,
      )
      if (
        controller.signal.aborted ||
        store.get(difyBuilderSessionViewAtom)?.session_id !== view.session_id
      )
        return false
      const merged = mergeConversation(page.data, store.get(difyBuilderConversationAtom))
      setConversation(merged)
      confirmLocalUserMessage(view.session_id, page.data)
      runEvents?.restoreRun(view.session_id, merged)
      setConversationHasMore(page.has_more)
      return page.data.length > 0
    } catch (error) {
      const message = await requestErrorMessage(error)
      if (!controller.signal.aborted) setLastError(message)
      return false
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setConversationLoading(false)
    }
  }, [
    confirmLocalUserMessage,
    runEvents,
    setConversation,
    setConversationHasMore,
    setConversationLoading,
    setLastError,
    store,
    abortRef,
  ])

  return { confirmLocalUserMessage, syncConversation, syncConversationRange, loadOlderConversation }
}
