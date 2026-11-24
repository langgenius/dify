'use client'

import type { AgentToolAction } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
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
  const [draft, setDraft] = useState(String(limit ?? 3))
  const [invalid, setInvalid] = useState(false)
  const titleId = useId()

  const [previousLimit, setPreviousLimit] = useState(limit)
  if (previousLimit !== limit) {
    setPreviousLimit(limit)
    if (limit != null) {
      setLastValid(limit)
      setDraft(String(limit))
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
  const commit = () => {
    if (!enabled) return
    const value = Number(draft)
    if (!draft.trim() || !Number.isSafeInteger(value) || value <= 0) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setLastValid(value)
    if (value !== limit) save(value)
  }

  const step = (direction: number) => {
    const parsed = Number(draft)
    const next = Math.max(
      1,
      (Number.isSafeInteger(parsed) && parsed > 0 ? parsed : lastValid) + direction,
    )
    if (!Number.isSafeInteger(next)) return
    setDraft(String(next))
    setLastValid(next)
    setInvalid(false)
    save(next)
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t(($) => $['toolCallLimit.label'], { toolName: action.name })}
        className={cn(
          'shrink-0 rounded-md px-1 py-0.5 system-xs-regular text-text-tertiary hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
          !enabled &&
            'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100',
        )}
      >
        {summary || t(($) => $['toolCallLimit.set'])}
        <span
          aria-hidden
          className="ms-0.5 i-ri-arrow-down-s-line inline-block size-3 align-middle"
        />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} aria-labelledby={titleId} className="w-62 p-3">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            commit()
          }}
        >
          <Field className="mb-2 flex items-center justify-between">
            <FieldLabel id={titleId} className="system-sm-medium">
              {t(($) => $['toolCallLimit.title'])}
            </FieldLabel>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setInvalid(false)
                setDraft(String(lastValid))
                save(checked ? lastValid : null)
              }}
            />
          </Field>
          <Field invalid={invalid} className="grid-cols-[1fr_5rem] items-center">
            <FieldLabel className={cn('system-sm-regular', !enabled && 'text-text-disabled')}>
              {t(($) => $['toolCallLimit.maximum'])}
            </FieldLabel>
            <InputGroup className="w-20">
              <InputGroupInput
                name="maximumCalls"
                type="number"
                min={1}
                step={1}
                required
                disabled={!enabled}
                value={draft}
                onValueChange={(value) => {
                  setDraft(value)
                  if (Number.isSafeInteger(Number(value)) && Number(value) > 0) setInvalid(false)
                }}
                onBlur={commit}
              />
              <InputGroupAddon
                align="inline-end"
                className="w-6 flex-col border-s border-divider-subtle p-0"
              >
                <IconButton
                  type="button"
                  size="xs"
                  className="w-full flex-1 rounded-none"
                  disabled={!enabled}
                  aria-label={t(($) => $['operation.increaseValue'], { ns: 'common' })}
                  onClick={() => step(1)}
                >
                  <span aria-hidden className="i-ri-arrow-up-s-line size-3" />
                </IconButton>
                <IconButton
                  type="button"
                  size="xs"
                  className="w-full flex-1 rounded-none"
                  disabled={!enabled || Number(draft) === 1}
                  aria-label={t(($) => $['operation.decreaseValue'], { ns: 'common' })}
                  onClick={() => step(-1)}
                >
                  <span aria-hidden className="i-ri-arrow-down-s-line size-3" />
                </IconButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError match={invalid} className="col-span-2">
              {t(($) => $['toolCallLimit.invalid'])}
            </FieldError>
          </Field>
        </form>
      </PopoverContent>
    </Popover>
  )
}
