'use client'

import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2RecipientType } from '../recipient-utils'
import type { HumanInputV2Recipient } from '../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VarType } from '@/app/components/workflow/types'
import { mockContactRecipientOptionProvider } from '../contact-provider'
import {
  addRecipient,
  createRecipientDraft,
  getRecipientCanonicalKey,
  getRecipientValidationError,
  hasDuplicateRecipients,
  removeRecipient,
  updateRecipient,
} from '../recipient-utils'

type RecipientsProps = {
  nodeId: string
  value: HumanInputV2Recipient[]
  onChange: (value: HumanInputV2Recipient[]) => void
  readonly: boolean
  provider?: ContactRecipientOptionProvider
}

const getOptionLabel = (option: ContactRecipientOption) => `${option.name} · ${option.email}`

type RecipientEditorState = {
  index?: number
  draft: HumanInputV2Recipient
}

type ContactSourceFilter = 'all' | ContactRecipientOption['source']

const recipientTypes: HumanInputV2RecipientType[] = [
  'contact',
  'dynamic_email',
  'onetime_email',
  'initiator',
]

const contactSourceFilters: ContactSourceFilter[] = ['all', 'workspace', 'organization', 'external']

const cloneRecipient = (recipient: HumanInputV2Recipient): HumanInputV2Recipient => {
  if (recipient.type === 'dynamic_email') return { ...recipient, selector: [...recipient.selector] }
  return { ...recipient }
}

const Recipients = ({
  nodeId,
  value,
  onChange,
  readonly,
  provider = mockContactRecipientOptionProvider,
}: RecipientsProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ContactRecipientOption[]>([])
  const [sourceFilter, setSourceFilter] = useState<ContactSourceFilter>('all')
  const [resolvedOptions, setResolvedOptions] = useState<ContactRecipientOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [editor, setEditor] = useState<RecipientEditorState>()
  const [editorError, setEditorError] = useState<'invalid' | 'duplicate'>()
  const firstOptionRef = useRef<HTMLButtonElement>(null)

  const selectedKeys = useMemo(
    () => new Set(value.map(getRecipientCanonicalKey).filter((key): key is string => !!key)),
    [value],
  )
  const resolvedMap = useMemo(
    () => new Map(resolvedOptions.map((option) => [option.id, option])),
    [resolvedOptions],
  )
  const visibleOptions = useMemo(
    () =>
      sourceFilter === 'all' ? options : options.filter((option) => option.source === sourceFilter),
    [options, sourceFilter],
  )
  const recipientRows = useMemo(() => {
    const occurrences = new Map<string, number>()
    return value.map((recipient, index) => {
      const baseKey =
        getRecipientCanonicalKey(recipient) ?? `${recipient.type}:${JSON.stringify(recipient)}`
      const occurrence = occurrences.get(baseKey) ?? 0
      occurrences.set(baseKey, occurrence + 1)
      return { recipient, index, key: `${baseKey}:${occurrence}` }
    })
  }, [value])

  useEffect(() => {
    const ids = value
      .filter(
        (recipient): recipient is Extract<HumanInputV2Recipient, { type: 'contact' }> =>
          recipient.type === 'contact',
      )
      .map((recipient) => recipient.contact_id)
    if (!ids.length) return

    let active = true
    provider
      .resolve(ids)
      .then((result) => {
        if (active) setResolvedOptions(result)
      })
      .catch(() => {
        if (active) setResolvedOptions([])
      })
    return () => {
      active = false
    }
  }, [provider, value])

  const loadOptions = useCallback(
    async (nextQuery: string) => {
      setLoading(true)
      setLoadError(false)
      try {
        setOptions(await provider.search(nextQuery))
      } catch {
        setOptions([])
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    },
    [provider],
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (readonly) return
    setOpen(nextOpen)
    if (nextOpen) {
      setQuery('')
      setSourceFilter('all')
      void loadOptions('')
    }
  }

  const add = (recipient: HumanInputV2Recipient) => {
    const nextValue = addRecipient(value, recipient)
    if (nextValue !== value) onChange(nextValue)
    setOpen(false)
  }

  const addOneTimeEmail = () => {
    const recipient: HumanInputV2Recipient = { type: 'onetime_email', email: emailDraft.trim() }
    const invalid = !!getRecipientValidationError(recipient)
    const duplicate = selectedKeys.has(getRecipientCanonicalKey(recipient) || '')
    setEmailError(invalid || duplicate)
    if (invalid || duplicate) return
    onChange([...value, recipient])
    setEmailDraft('')
  }

  const openEditor = (index?: number) => {
    if (index !== undefined && !value[index]) return
    const draft =
      index === undefined ? createRecipientDraft('onetime_email') : cloneRecipient(value[index]!)
    setEditor({ index, draft })
    setEditorError(undefined)
    if (draft.type === 'contact') void loadOptions('')
  }

  const closeEditor = () => {
    setEditor(undefined)
    setEditorError(undefined)
  }

  const setEditorType = (type: HumanInputV2RecipientType) => {
    setEditor((current) => current && { ...current, draft: createRecipientDraft(type) })
    setEditorError(undefined)
    if (type === 'contact') void loadOptions('')
  }

  const saveEditor = () => {
    if (!editor) return
    if (getRecipientValidationError(editor.draft)) {
      setEditorError('invalid')
      return
    }

    const draftKey = getRecipientCanonicalKey(editor.draft)
    const duplicate = value.some(
      (recipient, index) =>
        index !== editor.index && getRecipientCanonicalKey(recipient) === draftKey,
    )
    if (duplicate) {
      setEditorError('duplicate')
      return
    }

    onChange(
      editor.index === undefined
        ? [...value, editor.draft]
        : updateRecipient(value, editor.index, editor.draft),
    )
    closeEditor()
  }

  const getRecipientLabel = (recipient: HumanInputV2Recipient) => {
    if (recipient.type === 'initiator')
      return t(($) => $['nodes.humanInputV2.recipients.initiator'], { ns: 'workflow' })
    if (recipient.type === 'contact')
      return resolvedMap.get(recipient.contact_id)
        ? getOptionLabel(resolvedMap.get(recipient.contact_id)!)
        : recipient.contact_id
    if (recipient.type === 'dynamic_email') return recipient.selector.join(' / ')
    return recipient.email
  }

  return (
    <section className="px-4 py-2" aria-labelledby={`${nodeId}-recipients-label`}>
      <div className="mb-1 flex h-6 items-center gap-0.5">
        <h3
          id={`${nodeId}-recipients-label`}
          className="system-sm-semibold-uppercase text-text-secondary"
        >
          {t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })}
        </h3>
        <Infotip aria-label={t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}>
          {t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
        </Infotip>
      </div>

      <div
        className={cn(
          'min-h-20 rounded-lg border border-components-input-border-active bg-components-input-bg-normal p-2',
          readonly && 'opacity-70',
        )}
      >
        {!!value.length && (
          <div className="mb-2 flex flex-wrap gap-1" aria-live="polite">
            {recipientRows.map(({ recipient, index, key }) => {
              const invalid =
                !!getRecipientValidationError(recipient) ||
                (hasDuplicateRecipients(value) &&
                  value.findIndex(
                    (item) =>
                      getRecipientCanonicalKey(item) === getRecipientCanonicalKey(recipient),
                  ) !== index)
              return (
                <div
                  key={key}
                  className={cn(
                    'flex min-h-5 max-w-full items-center gap-1 rounded-md bg-components-badge-bg-dimm px-1.5 py-0.5 system-xs-medium text-text-secondary',
                    invalid && 'bg-state-destructive-hover text-text-destructive',
                  )}
                >
                  <span className="max-w-[260px] truncate">{getRecipientLabel(recipient)}</span>
                  {!readonly && (
                    <>
                      <button
                        type="button"
                        aria-label={t(($) => $['nodes.humanInputV2.recipients.edit'], {
                          ns: 'workflow',
                          recipient: getRecipientLabel(recipient) || recipient.type,
                        })}
                        className="flex size-4 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                        onClick={() => openEditor(index)}
                      >
                        <span className="i-ri-edit-line size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t(($) => $['nodes.humanInputV2.recipients.remove'], {
                          ns: 'workflow',
                          recipient: getRecipientLabel(recipient) || recipient.type,
                        })}
                        className="flex size-4 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                        onClick={() => onChange(removeRecipient(value, index))}
                      >
                        <span className="i-ri-close-line size-3" aria-hidden />
                      </button>
                    </>
                  )}
                  {invalid && (
                    <span className="sr-only">
                      {t(($) => $['nodes.humanInputV2.error.recipientInvalid'], {
                        ns: 'workflow',
                      })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {!readonly && (
          <div className="flex items-center gap-1">
            <Input
              aria-label={t(($) => $['nodes.humanInputV2.recipients.emailLabel'], {
                ns: 'workflow',
              })}
              value={emailDraft}
              onChange={(event) => {
                setEmailDraft(event.target.value)
                setEmailError(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addOneTimeEmail()
                }
              }}
              placeholder={t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                ns: 'workflow',
              })}
              aria-invalid={emailError}
              aria-describedby={emailError ? `${nodeId}-recipient-email-error` : undefined}
              className="min-w-0 grow border-0 bg-transparent"
            />
            {!!emailDraft && (
              <Button size="small" onClick={addOneTimeEmail}>
                {t(($) => $['nodes.humanInputV2.recipients.addEmail'], { ns: 'workflow' })}
              </Button>
            )}
          </div>
        )}
        {emailError && (
          <div
            id={`${nodeId}-recipient-email-error`}
            role="alert"
            className="mt-1 system-xs-regular text-text-destructive"
          >
            {t(($) => $['nodes.humanInputV2.recipients.emailInvalidOrDuplicate'], {
              ns: 'workflow',
            })}
          </div>
        )}
        {!value.length && readonly && (
          <div className="system-xs-regular text-text-tertiary">
            {t(($) => $['nodes.humanInputV2.recipients.empty'], { ns: 'workflow' })}
          </div>
        )}
      </div>

      {editor && !readonly && (
        <div
          className="mt-2 space-y-2 rounded-lg border border-components-panel-border bg-components-panel-bg p-2"
          role="group"
          aria-labelledby={`${nodeId}-recipient-editor-title`}
          aria-describedby={editorError ? `${nodeId}-recipient-editor-error` : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <div
              id={`${nodeId}-recipient-editor-title`}
              className="system-xs-semibold-uppercase text-text-secondary"
            >
              {t(
                ($) =>
                  $[
                    editor.index === undefined
                      ? 'nodes.humanInputV2.recipients.addRecipient'
                      : 'nodes.humanInputV2.recipients.editRecipient'
                  ],
                { ns: 'workflow' },
              )}
            </div>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-md border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              aria-label={t(($) => $['nodes.humanInputV2.recipients.cancel'], {
                ns: 'workflow',
              })}
              onClick={closeEditor}
            >
              <span className="i-ri-close-line size-3.5" aria-hidden />
            </button>
          </div>

          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={t(($) => $['nodes.humanInputV2.recipients.typeLabel'], { ns: 'workflow' })}
          >
            {recipientTypes.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={editor.draft.type === type}
                className={cn(
                  'rounded-md border border-components-button-secondary-border px-2 py-1 system-xs-medium text-text-secondary focus-visible:ring-1 focus-visible:ring-state-accent-solid',
                  editor.draft.type === type &&
                    'bg-state-accent-solid text-text-primary-on-surface',
                )}
                onClick={() => setEditorType(type)}
              >
                {t(($) => $[`nodes.humanInputV2.recipients.type.${type}`], {
                  ns: 'workflow',
                })}
              </button>
            ))}
          </div>

          {editor.draft.type === 'onetime_email' && (
            <Input
              aria-label={t(($) => $['nodes.humanInputV2.recipients.emailLabel'], {
                ns: 'workflow',
              })}
              aria-invalid={editorError === 'invalid'}
              value={editor.draft.email}
              onChange={(event) => {
                setEditor((current) =>
                  current && current.draft.type === 'onetime_email'
                    ? { ...current, draft: { ...current.draft, email: event.target.value } }
                    : current,
                )
                setEditorError(undefined)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  saveEditor()
                }
              }}
            />
          )}

          {editor.draft.type === 'contact' && (
            <div className="space-y-1">
              <Input
                aria-label={t(($) => $['nodes.humanInputV2.recipients.search'], {
                  ns: 'workflow',
                })}
                placeholder={t(($) => $['nodes.humanInputV2.recipients.searchPlaceholder'], {
                  ns: 'workflow',
                })}
                onChange={(event) => void loadOptions(event.target.value)}
              />
              <div className="max-h-32 overflow-y-auto">
                {loading && (
                  <div role="status" className="p-2 system-xs-regular text-text-tertiary">
                    {t(($) => $['nodes.humanInputV2.recipients.loading'], { ns: 'workflow' })}
                  </div>
                )}
                {!loading && loadError && (
                  <div role="alert" className="p-2 system-xs-regular text-text-destructive">
                    {t(($) => $['nodes.humanInputV2.recipients.loadError'], { ns: 'workflow' })}
                  </div>
                )}
                {!loading &&
                  !loadError &&
                  options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={
                        editor.draft.type === 'contact' && editor.draft.contact_id === option.id
                      }
                      className="flex w-full items-center justify-between rounded-md border-0 bg-transparent px-2 py-1 text-left system-xs-regular text-text-secondary hover:bg-state-base-hover focus-visible:bg-state-base-hover"
                      onClick={() => {
                        setEditor(
                          (current) =>
                            current && {
                              ...current,
                              draft: { type: 'contact', contact_id: option.id },
                            },
                        )
                        setEditorError(undefined)
                      }}
                    >
                      <span>{getOptionLabel(option)}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {editor.draft.type === 'dynamic_email' && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-components-input-bg-normal px-2 py-1">
              <span className="min-w-0 truncate system-xs-regular text-text-secondary">
                {editor.draft.selector.length
                  ? editor.draft.selector.join(' / ')
                  : t(($) => $['nodes.humanInputV2.recipients.variableRequired'], {
                      ns: 'workflow',
                    })}
              </span>
              <VarReferencePicker
                nodeId={nodeId}
                readonly={false}
                value={editor.draft.selector}
                isShowNodeName
                filterVar={(variable: Var) =>
                  [VarType.string, VarType.secret].includes(variable.type)
                }
                trigger={
                  <Button size="small">
                    {t(($) => $['nodes.humanInputV2.recipients.chooseVariable'], {
                      ns: 'workflow',
                    })}
                  </Button>
                }
                onChange={(selector) => {
                  if (!Array.isArray(selector)) return
                  setEditor(
                    (current) =>
                      current && {
                        ...current,
                        draft: {
                          type: 'dynamic_email',
                          selector: selector as ValueSelector,
                        },
                      },
                  )
                  setEditorError(undefined)
                }}
              />
            </div>
          )}

          {editor.draft.type === 'initiator' && (
            <div className="rounded-md bg-components-input-bg-normal px-2 py-1.5 system-xs-regular text-text-secondary">
              {t(($) => $['nodes.humanInputV2.recipients.initiatorDescription'], {
                ns: 'workflow',
              })}
            </div>
          )}

          {editorError && (
            <div
              id={`${nodeId}-recipient-editor-error`}
              role="alert"
              className="system-xs-regular text-text-destructive"
            >
              {t(
                ($) =>
                  $[
                    editorError === 'duplicate'
                      ? 'nodes.humanInputV2.error.recipientDuplicate'
                      : 'nodes.humanInputV2.error.recipientInvalid'
                  ],
                { ns: 'workflow' },
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="small" onClick={closeEditor}>
              {t(($) => $['nodes.humanInputV2.recipients.cancel'], { ns: 'workflow' })}
            </Button>
            <Button size="small" onClick={saveEditor}>
              {t(($) => $['nodes.humanInputV2.recipients.confirm'], { ns: 'workflow' })}
            </Button>
          </div>
        </div>
      )}

      {!readonly && (
        <div className="mt-1 flex items-center gap-1">
          <Button variant="ghost" size="small" onClick={() => openEditor()}>
            <span className="i-ri-add-line size-3.5" aria-hidden />
            {t(($) => $['nodes.humanInputV2.recipients.addRecipient'], { ns: 'workflow' })}
          </Button>
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="small">
                  <span className="i-ri-contacts-line size-3.5" aria-hidden />
                  {t(($) => $['nodes.humanInputV2.recipients.addContact'], { ns: 'workflow' })}
                </Button>
              }
            />
            <PopoverContent placement="bottom-start" sideOffset={4} className="w-80! p-1!">
              <Input
                aria-label={t(($) => $['nodes.humanInputV2.recipients.search'], { ns: 'workflow' })}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  void loadOptions(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    firstOptionRef.current?.focus()
                  }
                  if (event.key === 'Enter') {
                    const option = visibleOptions.find(
                      (option) => !selectedKeys.has(`contact:${option.id}`),
                    )
                    if (option) add({ type: 'contact', contact_id: option.id })
                  }
                  if (event.key === 'Escape') setOpen(false)
                }}
                placeholder={t(($) => $['nodes.humanInputV2.recipients.searchPlaceholder'], {
                  ns: 'workflow',
                })}
              />
              <div
                className="mt-1 flex gap-0.5 overflow-x-auto"
                role="tablist"
                aria-label={t(($) => $['nodes.humanInputV2.recipients.contactSourceLabel'], {
                  ns: 'workflow',
                })}
              >
                {contactSourceFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="tab"
                    aria-selected={sourceFilter === filter}
                    className={cn(
                      'shrink-0 rounded-md border-0 bg-transparent px-2 py-1 system-xs-medium text-text-tertiary focus-visible:ring-1 focus-visible:ring-state-accent-solid',
                      sourceFilter === filter && 'bg-state-accent-active text-text-accent',
                    )}
                    onClick={() => setSourceFilter(filter)}
                  >
                    {t(($) => $[`nodes.humanInputV2.recipients.contactSource.${filter}`], {
                      ns: 'workflow',
                    })}
                  </button>
                ))}
              </div>
              <div className="mt-1 max-h-64 overflow-y-auto" aria-live="polite">
                {loading && (
                  <div role="status" className="p-3 system-xs-regular text-text-tertiary">
                    {t(($) => $['nodes.humanInputV2.recipients.loading'], { ns: 'workflow' })}
                  </div>
                )}
                {!loading && loadError && (
                  <div role="alert" className="p-3 system-xs-regular text-text-destructive">
                    {t(($) => $['nodes.humanInputV2.recipients.loadError'], { ns: 'workflow' })}
                  </div>
                )}
                {!loading && !loadError && !visibleOptions.length && (
                  <div className="p-3 system-xs-regular text-text-tertiary">
                    {t(($) => $['nodes.humanInputV2.recipients.noResults'], { ns: 'workflow' })}
                  </div>
                )}
                {!loading &&
                  !loadError &&
                  visibleOptions.map((option, index) => {
                    const added = selectedKeys.has(`contact:${option.id}`)
                    return (
                      <button
                        key={option.id}
                        ref={index === 0 ? firstOptionRef : undefined}
                        type="button"
                        disabled={added}
                        className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover disabled:opacity-50"
                        onClick={() => add({ type: 'contact', contact_id: option.id })}
                      >
                        <span className="flex size-6 items-center justify-center rounded-full bg-components-icon-bg-blue-solid text-text-primary-on-surface">
                          {option.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 grow">
                          <span className="block truncate system-xs-medium text-text-secondary">
                            {option.name}
                          </span>
                          <span className="block truncate system-xs-regular text-text-tertiary">
                            {option.email}
                          </span>
                        </span>
                        {added && (
                          <span className="system-xs-regular text-text-tertiary">
                            {t(($) => $['nodes.humanInputV2.recipients.added'], { ns: 'workflow' })}
                          </span>
                        )}
                      </button>
                    )
                  })}
                <div className="my-1 h-px bg-divider-subtle" />
                <button
                  type="button"
                  disabled={selectedKeys.has('initiator')}
                  className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-state-base-hover disabled:opacity-50"
                  onClick={() => add({ type: 'initiator' })}
                >
                  <span className="i-ri-user-line size-5 text-text-secondary" aria-hidden />
                  <span className="system-xs-medium text-text-secondary">
                    {t(($) => $['nodes.humanInputV2.recipients.initiator'], { ns: 'workflow' })}
                  </span>
                </button>
              </div>
            </PopoverContent>
          </Popover>

          <VarReferencePicker
            nodeId={nodeId}
            readonly={readonly}
            value={[]}
            isShowNodeName
            filterVar={(variable: Var) => [VarType.string, VarType.secret].includes(variable.type)}
            trigger={
              <Button variant="ghost" size="small">
                <span className="i-ri-add-line size-3.5" aria-hidden />
                {t(($) => $['nodes.humanInputV2.recipients.insertVariable'], { ns: 'workflow' })}
              </Button>
            }
            onChange={(selector) => {
              if (!Array.isArray(selector)) return
              const next = addRecipient(value, {
                type: 'dynamic_email',
                selector: selector as ValueSelector,
              })
              if (next !== value) onChange(next)
            }}
          />
        </div>
      )}
    </section>
  )
}

export default Recipients
