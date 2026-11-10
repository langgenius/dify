import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { GenerativeUIAction } from '@/features/generative-ui/actions'
import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { toast } from '@/app/notifications'
import { createFormStateSaver } from '@/features/generative-ui/form-state-saver'
import { ChatContext } from '../context'

const GenerativeUIRenderer = dynamic(
  () => import('@/features/generative-ui/renderer').then((module) => module.GenerativeUIRenderer),
  { ssr: false },
)

type GenerativeUIContentProps = {
  messageId: string
  block: OpenUIContentBlock
  fallbackText: string
}

export const GenerativeUIContent = memo((props: GenerativeUIContentProps) => {
  return <GenerativeUIContentSession key={`${props.messageId}:${props.block.id}`} {...props} />
})

function GenerativeUIContentSession({ messageId, block, fallbackText }: GenerativeUIContentProps) {
  const { t } = useTranslation(['common', 'appDebug'])
  const hostReadOnly = useContextSelector(
    ChatContext,
    (context) =>
      !!context.readonly || !!context.isResponding || !!context.inputDisabled || !context.onSend,
  )
  const onSend = useContextSelector(ChatContext, (context) => context.onSend)
  const onGenerativeUIStateChange = useContextSelector(
    ChatContext,
    (context) => context.onGenerativeUIStateChange,
  )
  const [stateSaver] = useState(() => createFormStateSaver(block.form_state))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const sendRef = useRef(onSend)
  const isReadOnly = hostReadOnly || block.status !== 'completed'

  useLayoutEffect(() => {
    // A pending save must use the current host's permission and send callback.
    sendRef.current = isReadOnly ? undefined : onSend
  }, [isReadOnly, onSend])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Preserve edits when switching messages before the debounce expires.
      void stateSaver.flush()
    }
  }, [stateSaver])

  const handleStateUpdate = useCallback(
    (state: Record<string, unknown>) => {
      if (isReadOnly || !onGenerativeUIStateChange) return
      stateSaver.schedule({
        state,
        save: () =>
          onGenerativeUIStateChange(
            messageId,
            block.id,
            state as NonNullable<OpenUIContentBlock['form_state']>,
          ),
        onError: () => toast.error(t(($) => $['api.actionFailed'])),
      })
    },
    [isReadOnly, onGenerativeUIStateChange, messageId, block.id, stateSaver, t],
  )

  const handleAction = useCallback(
    async (action: GenerativeUIAction) => {
      if (isReadOnly || submittingRef.current) return
      submittingRef.current = true
      setIsSubmitting(true)
      const values = Object.entries(action.formValues ?? {})
        .map(([name, value]) => `${name}: ${value}`)
        .join('\n')
      try {
        if ((await stateSaver.flush()) && mountedRef.current) {
          sendRef.current?.(values ? `${action.message}\n\n${values}` : action.message)
        }
      } finally {
        submittingRef.current = false
        if (mountedRef.current) setIsSubmitting(false)
      }
    },
    [isReadOnly, stateSaver],
  )

  return (
    <ErrorBoundary
      resetKeys={[block.id, block.source, block.status]}
      fallback={
        <p className="body-md-regular text-text-secondary">
          {fallbackText || t(($) => $['generativeUI.unavailable'], { ns: 'appDebug' })}
        </p>
      }
    >
      <GenerativeUIRenderer
        source={block.source}
        libraryVersion={block.library_version}
        isStreaming={block.status === 'streaming'}
        isReadOnly={isReadOnly || isSubmitting}
        initialState={block.form_state}
        fallbackText={fallbackText}
        onStateUpdate={handleStateUpdate}
        onAction={handleAction}
      />
    </ErrorBoundary>
  )
}
