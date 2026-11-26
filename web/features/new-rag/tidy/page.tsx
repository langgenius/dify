'use client'

import type { Confirmation } from './confirmation'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'
import { useConfirmation } from './confirmation'
import { TidyDialog } from './dialogs'
import { FindingsList } from './findings-list'
import { ScanList } from './scan-list'
import { SettingsCard } from './settings-card'
import { useActionError, useAttempt, useTidyActions, useTidySettings } from './use-tidy'

export function TidyPage() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { space } = useKnowledgeSpace()
  const spaceId = space.control_space_id
  const canManage = useKnowledgeSpacePermission('knowledge_space_edit')
  const { settings, summary, scanning, configure, retry, save, resume } = useTidySettings(spaceId)
  const { act, run, adopt } = useTidyActions(spaceId)
  const pending = configure.isPending || act.isPending || retry.isPending
  // Failures of actions taken on the page itself; a dialog reports its own.
  const page = useAttempt(useActionError())
  const dialog = useConfirmation()
  const queueFocusRef = useRef<HTMLButtonElement>(null)
  // A reviewed card leaves the queue, taking the button that opened the dialog with it.
  const restoreQueueFocusRef = useRef(false)
  const focusQueue = () => queueFocusRef.current?.focus({ preventScroll: true })

  function ask(request: Confirmation) {
    page.clear()
    restoreQueueFocusRef.current = false
    dialog.ask(request)
  }
  const conflicts = settings.data?.conflicts ?? true
  const retryScans = () => void page.attempt(resume)

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
      <h1 className="title-2xl-semi-bold text-text-primary">{t(($) => $['tidy.name'])}</h1>
      <p className="mt-2 body-sm-regular text-text-tertiary">{t(($) => $['tidy.description'])}</p>
      <SettingsCard
        settings={settings}
        summary={summary.data}
        canManage={canManage}
        busy={pending}
        saving={configure.isPending && !dialog.open}
        retrying={retry.isPending}
        onToggle={(enabled) => {
          if (enabled) ask({ kind: 'enable', conflicts })
          else void page.attempt(() => save(false, conflicts))
        }}
        onToggleConflicts={(enabled) => {
          if (enabled) ask({ kind: 'conflicts' })
          else void page.attempt(() => save(true, false))
        }}
        onRetry={retryScans}
      />
      <p className="mb-4 body-sm-regular text-text-tertiary">{t(($) => $['tidy.reviewNotice'])}</p>
      {page.error && (
        <p role="alert" className="mb-3 text-text-destructive">
          {page.error}
        </p>
      )}

      <ScanList
        spaceId={spaceId}
        canManage={canManage}
        scanning={settings.data?.enabled ?? false}
        live={scanning}
        retrying={retry.isPending}
        onRetry={retryScans}
      />

      <FindingsList
        spaceId={spaceId}
        summary={summary.data}
        live={scanning}
        canManage={canManage}
        busy={pending}
        activeTabRef={queueFocusRef}
        onConfirm={(plan) => ask({ kind: 'plan', ...plan })}
        onRewrite={(request) => ask({ kind: 'rewrite', ...request })}
        onRun={(plan) =>
          void page.attempt(async () => {
            await run(plan)
            focusQueue()
          })
        }
      />

      <TidyDialog
        request={dialog.request}
        open={dialog.open}
        opening={dialog.opening}
        pending={pending}
        onClose={dialog.close}
        finalFocus={() => {
          if (!restoreQueueFocusRef.current) return true
          focusQueue()
          return false
        }}
        onSave={async (withConflicts) => {
          await save(true, withConflicts)
          dialog.close()
        }}
        onRun={async (plan) => {
          await run(plan)
          restoreQueueFocusRef.current = true
          dialog.close()
        }}
        onAdopt={async (request, text) => {
          await adopt(request, text)
          restoreQueueFocusRef.current = true
          dialog.close()
          toast.success(t(($) => $['tidy.rewriteAccepted'], { title: request.targetTitle }))
        }}
      />
    </div>
  )
}
