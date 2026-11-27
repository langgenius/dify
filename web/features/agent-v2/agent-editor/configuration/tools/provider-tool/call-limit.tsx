'use client'

import type { AgentToolAction } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useSetAtom } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setProviderToolCallLimitAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'

export function ToolCallLimit({
  action,
  toolId,
  readOnly,
}: {
  action: AgentToolAction
  toolId: string
  readOnly: boolean
}) {
  const { t } = useTranslation(['agentV2', 'common'])
  const setCallLimit = useSetAtom(setProviderToolCallLimitAtom)
  const limit = action.maxCallsPerRun
  const enabled = limit != null
  const [lastValid, setLastValid] = useState(limit ?? 3)
  const [draft, setDraft] = useState<number | null>(limit ?? 3)
  const [invalid, setInvalid] = useState(false)
  const titleId = useId()

  const [previousLimit, setPreviousLimit] = useState(limit)
  if (previousLimit !== limit) {
    setPreviousLimit(limit)
    if (limit != null) {
      setLastValid(limit)
      setDraft(limit)
      setInvalid(false)
    }
  }

  const summary = enabled ? t(($) => $['toolCallLimit.summary'], { count: limit }) : ''
  if (readOnly)
    return summary ? (
      <span className="shrink-0 system-xs-regular text-text-tertiary">{summary}</span>
    ) : null

  const save = (value: number | null) =>
    setCallLimit({ toolId, actionId: action.id, maxCallsPerRun: value })
  const commit = (value = draft) => {
    if (!enabled) return
    if (value == null || !Number.isSafeInteger(value) || value <= 0) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setLastValid(value)
    if (value !== limit) save(value)
  }

  const triggerText = summary || t(($) => $['toolCallLimit.set'])

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${triggerText}: ${t(($) => $['toolCallLimit.label'], { toolName: action.name })}`}
        className={cn(
          'shrink-0 rounded-md py-0.5 ps-1.5 pe-1 system-xs-regular text-text-tertiary hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
          !enabled &&
            'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100',
        )}
      >
        {triggerText}
        <span
          aria-hidden
          className="ms-0.5 i-ri-arrow-down-s-line inline-block size-3.5 align-middle"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        aria-labelledby={titleId}
        className="w-62 px-3 py-2.5"
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <Field className="mb-2 flex items-center justify-between">
            <FieldLabel id={titleId} className="system-sm-semibold">
              {t(($) => $['toolCallLimit.title'])}
            </FieldLabel>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setInvalid(false)
                setDraft(lastValid)
                save(checked ? lastValid : null)
              }}
            />
          </Field>
          <Field invalid={invalid} className="grid-cols-[1fr_5rem] items-center gap-y-0">
            <FieldLabel className={cn('system-sm-regular', !enabled && 'text-text-disabled')}>
              {t(($) => $['toolCallLimit.maximum'])}
            </FieldLabel>
            <NumberField
              name="maximumCalls"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              smallStep={1}
              snapOnStep
              allowOutOfRange
              required
              disabled={!enabled}
              value={draft}
              onValueChange={(value) => {
                setDraft(value)
                if (value != null && Number.isSafeInteger(value) && value > 0) setInvalid(false)
              }}
              onValueCommitted={(value) => commit(value)}
            >
              <NumberFieldGroup className="w-20">
                <NumberFieldInput
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commit()
                    }
                  }}
                />
                <NumberFieldControls>
                  <NumberFieldIncrement
                    aria-label={t(($) => $['operation.increaseValue'], { ns: 'common' })}
                  />
                  <NumberFieldDecrement
                    aria-label={t(($) => $['operation.decreaseValue'], { ns: 'common' })}
                  />
                </NumberFieldControls>
              </NumberFieldGroup>
            </NumberField>
            <div className="col-span-2" aria-live="polite" aria-atomic="true">
              <FieldError match={invalid} className="mt-1">
                {t(($) => $['toolCallLimit.invalid'])}
              </FieldError>
            </div>
          </Field>
        </form>
      </PopoverContent>
    </Popover>
  )
}
