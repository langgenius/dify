'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigureRightPanelMode } from './state'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

type PendingDraftSaveResult = { status: 'saved' } | { status: 'failed'; error: unknown }

export function useAgentConfigureSessionController({
  buildDraftAgentSoulConfig,
  hasActiveBuildDraft,
  isBuildDraftActive,
  mode,
  normalAgentSoulConfig,
  onModeChange,
}: {
  buildDraftAgentSoulConfig?: AgentSoulConfig
  hasActiveBuildDraft: boolean
  isBuildDraftActive: boolean
  mode: AgentConfigureRightPanelMode
  normalAgentSoulConfig?: AgentSoulConfig
  onModeChange: (mode: AgentConfigureRightPanelMode) => void | Promise<unknown>
}) {
  const [buildCallbackRevision, setBuildCallbackRevision] = useState(0)
  const [buildDraftActionsDisabled, setBuildDraftActionsDisabled] = useState(false)
  const [hasStartedBuildChat, setHasStartedBuildChat] = useState(false)
  const [isEnteringBuildMode, setIsEnteringBuildMode] = useState(false)
  const [showSwitchToPreviewConfirm, setShowSwitchToPreviewConfirm] = useState(false)
  const buildCallbackGeneration = useMemo(
    () => Symbol(`agent-build-session:${mode}:${buildCallbackRevision}`),
    [buildCallbackRevision, mode],
  )
  const buildCallbackGenerationRef = useRef(buildCallbackGeneration)
  const buildCallbacksEnabledRef = useRef(mode === 'build')
  const modeRef = useRef(mode)
  const pendingBuildModeTransitionRef = useRef<Promise<void> | null>(null)
  const pendingBuildDraftPreparationRef = useRef<Promise<unknown> | null>(null)
  const pendingPreviewDraftSaveRef = useRef<Promise<PendingDraftSaveResult> | null>(null)

  const rotateBuildCallbackGeneration = useCallback((enabled: boolean) => {
    buildCallbackGenerationRef.current = Symbol('invalid-agent-build-session')
    buildCallbacksEnabledRef.current = enabled
    setBuildCallbackRevision((revision) => revision + 1)
  }, [])

  useLayoutEffect(() => {
    buildCallbackGenerationRef.current = buildCallbackGeneration
  }, [buildCallbackGeneration])

  useLayoutEffect(() => {
    if (modeRef.current === mode) return

    modeRef.current = mode
    buildCallbacksEnabledRef.current = mode === 'build'
  }, [mode])

  const isBuildCallbackCurrent = useCallback(
    (generation: symbol) =>
      buildCallbacksEnabledRef.current &&
      modeRef.current === 'build' &&
      buildCallbackGenerationRef.current === generation,
    [],
  )

  const registerPreviewDraftSave = useCallback((draftSave: Promise<unknown>) => {
    pendingPreviewDraftSaveRef.current = draftSave.then<
      PendingDraftSaveResult,
      PendingDraftSaveResult
    >(
      () => ({ status: 'saved' }),
      (error: unknown) => ({ status: 'failed', error }),
    )
  }, [])

  const waitForPendingPreviewDraftSave = useCallback(async () => {
    const pendingDraftSave = pendingPreviewDraftSaveRef.current
    if (!pendingDraftSave) return

    const result = await pendingDraftSave
    if (result.status === 'failed') throw result.error

    if (pendingPreviewDraftSaveRef.current === pendingDraftSave)
      pendingPreviewDraftSaveRef.current = null
  }, [])

  const waitForPendingBuildDraftPreparation = useCallback(async () => {
    const pendingBuildDraftPreparation = pendingBuildDraftPreparationRef.current
    if (!pendingBuildDraftPreparation) return

    await pendingBuildDraftPreparation.catch(() => undefined)
  }, [])

  const runBuildPreparation = useCallback(
    async <T>({
      generation,
      markBuildChatStarted = false,
      prepare,
    }: {
      generation: symbol
      markBuildChatStarted?: boolean
      prepare: () => Promise<T>
    }) => {
      if (!isBuildCallbackCurrent(generation))
        throw new Error('The Build session is no longer active.')

      if (markBuildChatStarted) {
        setHasStartedBuildChat(true)
        setBuildDraftActionsDisabled(true)
      }

      const preparation = (async () => {
        const result = await prepare()
        if (!isBuildCallbackCurrent(generation))
          throw new Error('The Build session is no longer active.')
        return result
      })()
      pendingBuildDraftPreparationRef.current = preparation

      try {
        return await preparation
      } catch (error) {
        if (markBuildChatStarted && isBuildCallbackCurrent(generation)) {
          setBuildDraftActionsDisabled(false)
          setHasStartedBuildChat(false)
        }
        throw error
      } finally {
        if (pendingBuildDraftPreparationRef.current === preparation)
          pendingBuildDraftPreparationRef.current = null
      }
    },
    [isBuildCallbackCurrent],
  )

  const finishBuildAction = useCallback(
    (generation: symbol) => {
      if (!isBuildCallbackCurrent(generation)) return
      setBuildDraftActionsDisabled(false)
    },
    [isBuildCallbackCurrent],
  )

  const resetBuildSessionState = useCallback(() => {
    const keepBuildCallbacksEnabled =
      buildCallbacksEnabledRef.current && modeRef.current === 'build'
    rotateBuildCallbackGeneration(keepBuildCallbacksEnabled)
    setBuildDraftActionsDisabled(false)
    setHasStartedBuildChat(false)
  }, [rotateBuildCallbackGeneration])

  const resetBuildSession = useCallback(
    async (onResetBuildSession: () => Promise<void>) => {
      try {
        await onResetBuildSession()
      } finally {
        resetBuildSessionState()
      }
    },
    [resetBuildSessionState],
  )

  const discardBuildDraftAndSwitchToPreview = useCallback(
    async (discardBuildDraft: () => Promise<boolean>, stopBuildChat: () => void) => {
      rotateBuildCallbackGeneration(false)
      stopBuildChat()
      await waitForPendingBuildDraftPreparation()
      const discarded = await discardBuildDraft()
      if (!discarded) {
        rotateBuildCallbackGeneration(true)
        return false
      }

      modeRef.current = 'preview'
      onModeChange('preview')
      return true
    },
    [onModeChange, rotateBuildCallbackGeneration, waitForPendingBuildDraftPreparation],
  )

  const changeMode = useCallback(
    (
      nextMode: AgentConfigureRightPanelMode,
      {
        discardBuildDraft,
        rebaseComposerDraft,
        savePreviewDraft,
        startFreshBuildSession,
        stopBuildChat,
      }: {
        discardBuildDraft: () => Promise<boolean>
        rebaseComposerDraft: (agentSoulConfig?: AgentSoulConfig) => void
        savePreviewDraft: () => Promise<unknown>
        startFreshBuildSession?: () => Promise<boolean>
        stopBuildChat: () => void
      },
    ) => {
      if (nextMode === modeRef.current) return

      const isLeavingBuildMode = modeRef.current === 'build' && nextMode === 'preview'
      if (isLeavingBuildMode && (hasActiveBuildDraft || hasStartedBuildChat)) {
        setShowSwitchToPreviewConfirm(true)
        return
      }
      if (isLeavingBuildMode && pendingBuildDraftPreparationRef.current) {
        void discardBuildDraftAndSwitchToPreview(discardBuildDraft, stopBuildChat)
        return
      }
      if (isLeavingBuildMode) rotateBuildCallbackGeneration(false)

      const nextUsesBuildDraft = nextMode === 'build' && hasActiveBuildDraft
      const isEnteringBuildMode = modeRef.current === 'preview' && nextMode === 'build'
      if (isEnteringBuildMode) {
        if (startFreshBuildSession) {
          if (pendingBuildModeTransitionRef.current) return

          setIsEnteringBuildMode(true)
          modeRef.current = 'build'
          rotateBuildCallbackGeneration(true)
          const buildSessionStart = startFreshBuildSession()
          const modeChange = (async () => onModeChange(nextMode))()
          const transition = (async () => {
            const [buildSessionResult, modeChangeResult] = await Promise.allSettled([
              buildSessionStart,
              modeChange,
            ])
            const buildSessionStarted =
              buildSessionResult.status === 'fulfilled' && buildSessionResult.value
            const modeChanged = modeChangeResult.status === 'fulfilled'
            if ((buildSessionStarted && modeChanged) || modeRef.current !== 'build') return

            modeRef.current = 'preview'
            rotateBuildCallbackGeneration(false)
            await Promise.resolve(onModeChange('preview')).catch(() => undefined)
          })()
          pendingBuildModeTransitionRef.current = transition
          void transition.finally(() => {
            if (pendingBuildModeTransitionRef.current === transition)
              pendingBuildModeTransitionRef.current = null
            setIsEnteringBuildMode(false)
          })
          return
        }

        modeRef.current = 'build'
        rotateBuildCallbackGeneration(true)
        registerPreviewDraftSave(savePreviewDraft())
        if (nextUsesBuildDraft) rebaseComposerDraft(buildDraftAgentSoulConfig)
        onModeChange(nextMode)
        return
      }

      if (nextUsesBuildDraft !== isBuildDraftActive) {
        rebaseComposerDraft(nextUsesBuildDraft ? buildDraftAgentSoulConfig : normalAgentSoulConfig)
      }
      modeRef.current = nextMode
      onModeChange(nextMode)
    },
    [
      buildDraftAgentSoulConfig,
      discardBuildDraftAndSwitchToPreview,
      hasActiveBuildDraft,
      hasStartedBuildChat,
      isBuildDraftActive,
      normalAgentSoulConfig,
      onModeChange,
      registerPreviewDraftSave,
      rotateBuildCallbackGeneration,
    ],
  )

  return {
    buildCallbackGeneration,
    buildDraftActionsDisabled,
    changeMode,
    confirmSwitchToPreview: discardBuildDraftAndSwitchToPreview,
    finishBuildAction,
    isEnteringBuildMode,
    isBuildCallbackCurrent,
    resetBuildSession,
    resetBuildSessionState,
    runBuildPreparation,
    setShowSwitchToPreviewConfirm,
    showSwitchToPreviewConfirm,
    waitForPendingPreviewDraftSave,
  }
}
