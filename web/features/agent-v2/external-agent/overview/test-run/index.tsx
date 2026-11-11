'use client'

import type { HotkeyChord } from '@tanstack/react-hotkeys'
import type { ExternalAgentOverviewPreview } from '../../preview'
import type { TestAgentAttachment } from './attachments'
import type { TestAgentRunOutcome } from './use-test-run'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { formatForDisplay, matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { TestAgentAttachments } from './attachments'
import { TestAgentResults } from './results'
import { useTestAgentRun } from './use-test-run'

type TestAgentProps = Pick<
  ExternalAgentOverviewPreview,
  'skills' | 'sampleResponse' | 'sampleTraceSteps' | 'tracing'
> & {
  sampleOutcome?: TestAgentRunOutcome
}

const VISIBLE_EXAMPLE_COUNT = 5
const RUN_TEST_HOTKEY = 'Mod+Enter' satisfies HotkeyChord

function TestAgentSession({
  skills,
  run,
  tab,
  setTab,
  startRun,
  stopRun,
  resetRun,
}: Pick<TestAgentProps, 'skills'> & ReturnType<typeof useTestAgentRun>) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [expanded, setExpanded] = useState(false)
  const [showAllExamples, setShowAllExamples] = useState(false)
  const [task, setTask] = useState(run?.task ?? '')
  const [attachments, setAttachments] = useState<TestAgentAttachment[]>(run?.attachments ?? [])
  const taskRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const actionLabelId = useId()
  const examplesId = useId()
  const examplesLabelId = useId()
  // Each skill supplies its own quick-start request, shared with the Skills section.
  const examples = skills.flatMap((skill) => {
    const request = skill.examples.find((example) => example.trim())
    return request ? [{ id: skill.id, name: skill.name, request }] : []
  })
  const visibleExamples = showAllExamples ? examples : examples.slice(0, VISIBLE_EXAMPLE_COUNT)
  const remaining = examples.length - VISIBLE_EXAMPLE_COUNT
  const isRunning = run?.status === 'running'
  const isStopping = run?.status === 'stopping'
  const isInProgress = isRunning || isStopping
  const canRun = !isInProgress && task.trim().length > 0

  function updateTask(value: string) {
    setTask(value)
    resetRun()
  }

  return (
    <DrawerPopup
      initialFocus={taskRef}
      className={cn(
        'data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-2xl',
        expanded
          ? 'data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:w-[calc(100vw-1rem)]'
          : 'data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:w-100',
      )}
    >
      <div className="relative shrink-0 px-4 pt-3.5 pb-1">
        <DrawerTitle className="pe-16 system-xl-semibold text-text-primary">
          {t(($) => $['external.overview.test'])}
        </DrawerTitle>
        <DrawerDescription className="mt-0.5 system-xs-regular text-text-tertiary">
          {isInProgress
            ? t(($) => $['external.overview.testRun.runningDescription'])
            : t(($) => $['external.overview.testDescription'])}
        </DrawerDescription>
        <div className="absolute end-2.5 top-2.5 flex">
          <IconButton
            size="lg"
            aria-label={
              expanded
                ? t(($) => $['external.overview.collapseTest'])
                : t(($) => $['external.overview.expandTest'])
            }
            onClick={() => setExpanded((value) => !value)}
          >
            <span
              aria-hidden
              className={cn(
                'size-4',
                expanded ? 'i-ri-collapse-diagonal-line' : 'i-ri-expand-diagonal-line',
              )}
            />
          </IconButton>
          <DrawerClose
            render={
              <IconButton size="lg" aria-label={t(($) => $['operation.close'], { ns: 'common' })}>
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </div>
      </div>
      <DrawerContent className="gap-3 px-4 pt-3 pb-4">
        <Form<{ task: string }>
          id={formId}
          className="shrink-0 space-y-2"
          onKeyDown={(event) => {
            if (
              !canRun ||
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target) ||
              !matchesKeyboardEvent(event.nativeEvent, RUN_TEST_HOTKEY)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) event.currentTarget.requestSubmit()
          }}
          onFormSubmit={(values) => {
            if (canRun) startRun(values.task, attachments)
          }}
        >
          <Field
            name="task"
            validate={(value) =>
              typeof value === 'string' && value.trim()
                ? null
                : t(($) => $['external.overview.requestRequired'])
            }
          >
            <FieldLabel className="system-xs-medium">
              {t(($) => $['external.overview.testRequest'])}
            </FieldLabel>
            <Textarea
              ref={taskRef}
              className={cn(
                isInProgress
                  ? 'field-sizing-content h-auto min-h-0 resize-none bg-components-input-bg-disabled text-text-secondary'
                  : 'h-30 min-h-30 resize-y',
              )}
              readOnly={isInProgress}
              value={task}
              onValueChange={updateTask}
              placeholder={t(($) => $['external.overview.testRequestPlaceholder'])}
            />
            <FieldError />
          </Field>
          {!run && examples.length > 0 && (
            <div
              id={examplesId}
              role="group"
              aria-labelledby={examplesLabelId}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
            >
              <span id={examplesLabelId} className="system-xs-regular text-text-tertiary">
                {t(($) => $['external.overview.examples'])}
              </span>
              {visibleExamples.map((example) => (
                <Button
                  key={example.id}
                  type="button"
                  size="small"
                  variant="secondary"
                  className="h-auto min-h-6 max-w-full py-1 whitespace-normal"
                  onClick={() => {
                    updateTask(example.request)
                    taskRef.current?.focus()
                  }}
                >
                  {example.name}
                </Button>
              ))}
              {remaining > 0 && (
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  className="text-text-tertiary"
                  aria-expanded={showAllExamples}
                  aria-controls={examplesId}
                  onClick={() => setShowAllExamples((value) => !value)}
                >
                  {showAllExamples
                    ? t(($) => $['external.overview.fewerExamples'])
                    : t(($) => $['external.overview.moreExamples'], { remaining })}
                </Button>
              )}
            </div>
          )}
        </Form>
        {!isInProgress && (
          <TestAgentAttachments
            attachments={attachments}
            onChange={(value) => {
              setAttachments(value)
              resetRun()
            }}
          />
        )}
        <Button
          form={formId}
          type={isInProgress ? 'button' : 'submit'}
          variant={isInProgress ? 'secondary' : 'primary'}
          size={isInProgress ? 'medium' : 'large'}
          className={cn('w-full shrink-0 rounded-lg', isStopping && 'h-9 flex-row-reverse')}
          loading={isStopping}
          disabled={!isInProgress && !canRun}
          aria-labelledby={actionLabelId}
          onClick={
            isRunning
              ? (event) => {
                  event.preventDefault()
                  stopRun()
                }
              : undefined
          }
        >
          {!isStopping && (
            <span
              aria-hidden
              className={cn('size-4', isRunning ? 'i-ri-stop-circle-line' : 'i-ri-play-line')}
            />
          )}
          <span id={actionLabelId}>
            {isStopping
              ? t(($) => $['external.overview.testRun.stoppingLabel'])
              : isRunning
                ? t(($) => $['external.overview.testRun.stop'])
                : t(($) => $['external.overview.sendRequest'])}
          </span>
          {!isInProgress && (
            <KbdGroup aria-hidden>
              {formatForDisplay(RUN_TEST_HOTKEY, { parts: true }).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </Button>
        {run && (
          <div className="mt-5 shrink-0">
            <TestAgentResults run={run} tab={tab} onTabChange={setTab} />
          </div>
        )}
      </DrawerContent>
    </DrawerPopup>
  )
}

export function ExternalAgentTestPanel(props: TestAgentProps) {
  const { t } = useTranslation(['agentRoster'])
  const [open, setOpen] = useState(false)
  const notificationRef = useRef<string | null>(null)
  const triggerLabelId = useId()

  function dismissNotification() {
    if (notificationRef.current !== null) {
      toast.dismiss(notificationRef.current)
      notificationRef.current = null
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) dismissNotification()
    setOpen(nextOpen)
  }

  const testRun = useTestAgentRun({
    ...props,
    onCompleted(outcome) {
      // The open panel already presents the result at the action's owner.
      if (open) return
      dismissNotification()
      notificationRef.current = toast(
        outcome === 'succeeded'
          ? t(($) => $['external.overview.testRun.finishedToast'])
          : t(($) => $['external.overview.testRun.failedToast']),
        {
          type: outcome === 'succeeded' ? 'success' : 'error',
          actionProps: {
            children: t(($) => $['external.overview.testRun.viewResult']),
            variant: 'primary',
            onClick() {
              testRun.setTab('result')
              changeOpen(true)
            },
          },
        },
      )
    },
  })
  const isInProgress = testRun.run?.status === 'running' || testRun.run?.status === 'stopping'

  useEffect(
    () => () => {
      if (notificationRef.current !== null) toast.dismiss(notificationRef.current)
    },
    [],
  )

  return (
    <Drawer modal swipeDirection="right" open={open} onOpenChange={changeOpen}>
      <DrawerTrigger render={<Button variant="secondary" aria-labelledby={triggerLabelId} />}>
        <span
          aria-hidden
          className={cn(
            'size-4',
            isInProgress
              ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
              : 'i-ri-play-circle-line',
          )}
        />
        <span id={triggerLabelId}>
          {isInProgress
            ? t(($) => $['external.overview.testing'])
            : t(($) => $['external.overview.test'])}
        </span>
      </DrawerTrigger>
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <TestAgentSession skills={props.skills} {...testRun} />
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
