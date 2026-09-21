'use client'

import type { ReactElement } from 'react'
import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2RecipientType } from '../recipient-utils'
import type { HumanInputV2Recipient } from '../types'
import type { Node, ValueSelector, Var } from '@/app/components/workflow/types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VariableLabelInEditor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarType } from '@/app/components/workflow/types'
import { currentWorkspaceAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { ContactChannelIcon } from '@/features/contacts/management/channel-icon'
import { consoleQuery } from '@/service/client'
import { useContactRecipientOptionProvider } from '../contact-provider'
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
  workspace?: { name: string; contactCount?: number }
  availableNodes?: Node[]
}

const getOptionLabel = (option: ContactRecipientOption) =>
  option.email ? `${option.name} · ${option.email}` : option.name

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
  'all_workspace_contacts',
]

const contactSourceFilters: ContactSourceFilter[] = ['all', 'workspace', 'organization', 'external']

const cloneRecipient = (recipient: HumanInputV2Recipient): HumanInputV2Recipient => {
  if (recipient.type === 'dynamic_email') return { ...recipient, selector: [...recipient.selector] }
  return { ...recipient }
}

function RecipientContactPreview({
  contact,
  children,
}: {
  contact: ContactRecipientOption
  children: ReactElement
}) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger render={children} openOnHover delay={300} closeDelay={150} />
      <PopoverContent
        placement="left-start"
        sideOffset={4}
        className="flex w-60 flex-col gap-2 bg-components-tooltip-bg p-4 backdrop-blur-[5px]"
      >
        <div
          aria-hidden="true"
          className="size-10 shrink-0 rounded-full border-2 border-components-panel-bg"
        >
          <Avatar
            avatar={contact.avatar ?? null}
            name={contact.name}
            size="xl"
            className="size-full inset-ring-[0.5px] inset-ring-divider-regular"
          />
        </div>
        <div className="flex w-full flex-col gap-px">
          <div className="flex items-start gap-1">
            <PopoverTitle className="min-w-0 system-md-medium wrap-anywhere text-text-primary">
              {contact.name}
            </PopoverTitle>
            <span className="mt-0.5 shrink-0 rounded-[5px] bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
              {t(($) => $[`nodes.humanInputV2.recipients.contactSource.${contact.source}`], {
                ns: 'workflow',
              })}
            </span>
          </div>
          {contact.email && (
            <p className="system-xs-regular wrap-anywhere text-text-tertiary">{contact.email}</p>
          )}
        </div>
        {contact.email && (
          <div className="flex size-5 items-center justify-center rounded-[5px] border border-divider-regular bg-components-panel-on-panel-item-bg">
            <ContactChannelIcon provider="email" className="size-3.5" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

const RecipientsContent = ({
  nodeId,
  value,
  onChange,
  readonly,
  provider,
  workspace,
  availableNodes = [],
}: RecipientsProps & { provider: ContactRecipientOptionProvider }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchFromInput, setSearchFromInput] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ContactRecipientOption[]>([])
  const [sourceFilter, setSourceFilter] = useState<ContactSourceFilter>('all')
  const [resolvedOptions, setResolvedOptions] = useState<ContactRecipientOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchRequestRef = useRef(0)
  const searchQueryRef = useRef('')
  const [emailDraft, setEmailDraft] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [editor, setEditor] = useState<RecipientEditorState>()
  const [editorError, setEditorError] = useState<'invalid' | 'duplicate'>()
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const recipientInputRef = useRef<HTMLInputElement>(null)

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
    const ids = [
      ...new Set(
        value
          .filter(
            (recipient): recipient is Extract<HumanInputV2Recipient, { type: 'contact' }> =>
              recipient.type === 'contact',
          )
          .map((recipient) => recipient.contact_id),
      ),
    ]
    if (!ids.length) return

    let active = true
    provider
      .resolve({ contact_ids: ids })
      .then((result) => {
        if (active) setResolvedOptions(result)
      })
      .catch(() => {
        if (active)
          setResolvedOptions((current) => current.filter((option) => ids.includes(option.id)))
      })
    return () => {
      active = false
    }
  }, [provider, value])

  const loadOptions = useCallback(
    async (nextQuery: string, page = 1) => {
      const requestId = ++searchRequestRef.current
      searchQueryRef.current = nextQuery
      setLoading(page === 1)
      setLoadingMore(page > 1)
      setLoadError(false)
      if (page === 1) {
        setOptions([])
        setHasMore(false)
      }
      try {
        const result = provider.searchPage
          ? await provider.searchPage(nextQuery, page)
          : { data: await provider.search(nextQuery), page: 1, hasMore: false }
        if (requestId !== searchRequestRef.current) return
        setOptions((current) =>
          page === 1
            ? result.data
            : [
                ...new Map(
                  [...current, ...result.data].map((option) => [option.id, option]),
                ).values(),
              ],
        )
        setSearchPage(result.page)
        setHasMore(result.hasMore)
      } catch {
        if (requestId !== searchRequestRef.current) return
        setLoadError(true)
      } finally {
        if (requestId === searchRequestRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [provider],
  )

  const loadMore = () => {
    if (!hasMore || loading || loadingMore) return
    void loadOptions(searchQueryRef.current, searchPage + 1)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (readonly) return
    setOpen(nextOpen)
    if (nextOpen) {
      setSearchFromInput(false)
      setQuery('')
      setSourceFilter('all')
      void loadOptions('')
    }
  }

  const add = (recipient: HumanInputV2Recipient) => {
    const nextValue = addRecipient(value, recipient)
    if (recipient.type === 'contact') {
      const option = options.find((option) => option.id === recipient.contact_id)
      if (option) {
        setResolvedOptions((current) => [
          ...current.filter((item) => item.id !== option.id),
          option,
        ])
      }
    }
    if (nextValue !== value) onChange(nextValue)
    setEmailDraft('')
    setQuery('')
    setEmailError(false)
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
    setQuery('')
    setOpen(false)
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
    if (recipient.type === 'all_workspace_contacts')
      return (
        workspace?.name ||
        t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], { ns: 'workflow' })
      )
    if (recipient.type === 'initiator')
      return t(($) => $['nodes.humanInputV2.recipients.initiator'], { ns: 'workflow' })
    if (recipient.type === 'contact')
      return resolvedMap.get(recipient.contact_id)
        ? getOptionLabel(resolvedMap.get(recipient.contact_id)!)
        : recipient.contact_id
    if (recipient.type === 'dynamic_email') {
      const node = availableNodes.find((node) => node.id === recipient.selector[0])
      return (
        node ? [node.data.title, ...recipient.selector.slice(1)] : recipient.selector.slice(1)
      ).join(' / ')
    }
    return recipient.email
  }

  return (
    <section className="px-4 pt-2" aria-labelledby={`${nodeId}-recipients-label`}>
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
          'min-h-20 rounded-lg bg-components-input-bg-normal focus-within:ring-1 focus-within:ring-components-input-border-active',
          readonly && 'opacity-70',
        )}
      >
        {!!value.length && (
          <div className="flex flex-wrap gap-1 px-2 pt-2 pb-0.5" aria-live="polite">
            {recipientRows.map(({ recipient, index, key }) => {
              const contact =
                recipient.type === 'contact' ? resolvedMap.get(recipient.contact_id) : undefined
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
                    'flex h-5 max-w-full items-center gap-1 rounded-full bg-components-badge-white-to-dark p-0.5 system-xs-regular text-text-primary shadow-xs inset-ring-[0.5px] inset-ring-components-panel-border-subtle',
                    (recipient.type === 'initiator' ||
                      recipient.type === 'all_workspace_contacts') &&
                      'bg-util-colors-indigo-indigo-100 font-medium text-util-colors-indigo-indigo-700 inset-ring-util-colors-indigo-indigo-200',
                    recipient.type === 'dynamic_email' &&
                      'rounded-[5px] bg-util-colors-blue-blue-50 text-text-accent',
                    invalid && 'bg-state-destructive-hover text-text-destructive',
                  )}
                >
                  {recipient.type === 'onetime_email' && (
                    <Avatar
                      avatar={null}
                      name={recipient.email}
                      size="xxs"
                      className="[&>span]:text-[10px]"
                    />
                  )}
                  {(recipient.type === 'initiator' ||
                    recipient.type === 'all_workspace_contacts') && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface">
                      {recipient.type === 'all_workspace_contacts' && workspace?.name ? (
                        <WorkspaceAvatar
                          name={workspace.name}
                          size="xs"
                          className="size-4 rounded-full"
                        />
                      ) : (
                        <span
                          className={cn(
                            'size-3',
                            recipient.type === 'initiator'
                              ? 'i-ri-user-follow-line'
                              : 'i-ri-group-line',
                          )}
                          aria-hidden
                        />
                      )}
                    </span>
                  )}
                  {contact ? (
                    <RecipientContactPreview contact={contact}>
                      <button
                        type="button"
                        aria-label={getOptionLabel(contact)}
                        className="flex min-w-0 items-center gap-1 rounded-full border-0 bg-transparent p-0 text-left focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                      >
                        <span aria-hidden="true" className="flex shrink-0">
                          <Avatar
                            avatar={contact.avatar ?? null}
                            name={contact.name}
                            size="xxs"
                            className="[&>span]:text-[10px]"
                          />
                        </span>
                        <span className="max-w-[260px] truncate px-0.5">{contact.name}</span>
                      </button>
                    </RecipientContactPreview>
                  ) : recipient.type === 'dynamic_email' ? (
                    <VariableLabelInEditor
                      variables={recipient.selector}
                      nodeType={
                        availableNodes.find((node) => node.id === recipient.selector[0])?.data.type
                      }
                      nodeTitle={
                        availableNodes.find((node) => node.id === recipient.selector[0])?.data.title
                      }
                    />
                  ) : (
                    <span className="max-w-[260px] truncate px-0.5">
                      {getRecipientLabel(recipient)}
                    </span>
                  )}
                  {recipient.type === 'all_workspace_contacts' &&
                    workspace?.contactCount !== undefined && (
                      <span className="pr-1 text-text-tertiary">{workspace.contactCount}</span>
                    )}
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
          <div className="flex min-h-11 items-start gap-1 px-3 pt-2 pb-2">
            <Input
              ref={recipientInputRef}
              aria-label={t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                ns: 'workflow',
              })}
              value={emailDraft}
              onChange={(event) => {
                const nextQuery = event.target.value
                setEmailDraft(nextQuery)
                setQuery(nextQuery)
                setEmailError(false)
                setSearchFromInput(true)
                setSourceFilter('all')
                setOpen(!!nextQuery.trim())
                if (nextQuery.trim()) void loadOptions(nextQuery)
                else {
                  searchRequestRef.current += 1
                  searchQueryRef.current = ''
                  setOptions([])
                  setLoading(false)
                  setLoadingMore(false)
                  setLoadError(false)
                  setHasMore(false)
                }
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' && open) {
                  event.preventDefault()
                  firstOptionRef.current?.focus()
                }
                if (event.key === 'Escape') setOpen(false)
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const searchValue = emailDraft.trim().toLowerCase()
                  if (!searchValue) return
                  const option =
                    !loading &&
                    !loadError &&
                    searchQueryRef.current === emailDraft &&
                    visibleOptions.find(
                      (option) =>
                        !selectedKeys.has(`contact:${option.id}`) &&
                        (!searchValue.includes('@') || option.email.toLowerCase() === searchValue),
                    )
                  if (option) add({ type: 'contact', contact_id: option.id })
                  else addOneTimeEmail()
                }
              }}
              placeholder={t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                ns: 'workflow',
              })}
              aria-invalid={emailError}
              aria-describedby={emailError ? `${nodeId}-recipient-email-error` : undefined}
              className="h-5 min-w-0 grow rounded-none border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus:bg-transparent focus:shadow-none"
            />
            {emailDraft.includes('@') && (
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
            className="px-3 pb-1 system-xs-regular text-text-destructive"
          >
            {t(($) => $['nodes.humanInputV2.recipients.emailInvalidOrDuplicate'], {
              ns: 'workflow',
            })}
          </div>
        )}
        {!value.length && readonly && (
          <div className="px-3 py-2 system-xs-regular text-text-tertiary">
            {t(($) => $['nodes.humanInputV2.recipients.empty'], { ns: 'workflow' })}
          </div>
        )}
        {!readonly && (
          <div className="flex min-h-9 items-center gap-1 py-1.5 pr-2.5 pl-1.5">
            <Popover open={open} onOpenChange={handleOpenChange}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="small"
                    className="gap-1 pr-1.5 pl-1.25 text-text-tertiary"
                  >
                    <span className="i-ri-account-circle-line size-3.5" aria-hidden />
                    {t(($) => $['nodes.humanInputV2.recipients.addContact'], { ns: 'workflow' })}
                  </Button>
                }
              />
              <PopoverContent
                initialFocus={searchFromInput ? false : undefined}
                finalFocus={searchFromInput ? recipientInputRef : undefined}
                placement="bottom-start"
                sideOffset={4}
                className="w-80 bg-components-panel-bg-blur p-0 backdrop-blur-[5px]"
              >
                {!searchFromInput && (
                  <div className="px-2 pt-2 pb-1">
                    <InputGroup className="h-8">
                      <InputGroupAddon className="ps-1.75 pe-1.25">
                        <span
                          className="i-ri-search-line size-4 text-components-input-text-placeholder"
                          aria-hidden
                        />
                      </InputGroupAddon>
                      <InputGroupInput
                        aria-label={t(($) => $['nodes.humanInputV2.recipients.search'], {
                          ns: 'workflow',
                        })}
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value)
                          void loadOptions(event.target.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return
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
                        placeholder={t(
                          ($) => $['nodes.humanInputV2.recipients.searchPlaceholder'],
                          {
                            ns: 'workflow',
                          },
                        )}
                      />
                    </InputGroup>
                  </div>
                )}
                <div
                  className="flex gap-0.5 overflow-x-auto px-2 py-1"
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
                        sourceFilter === filter && 'bg-state-base-hover-alt text-text-primary',
                      )}
                      onClick={() => setSourceFilter(filter)}
                    >
                      {t(($) => $[`nodes.humanInputV2.recipients.contactSource.${filter}`], {
                        ns: 'workflow',
                      })}
                    </button>
                  ))}
                </div>
                <div className="max-h-84 overflow-y-auto p-1" aria-live="polite">
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
                  {!loading && !loadError && !visibleOptions.length && !hasMore && (
                    <div className="p-3 system-xs-regular text-text-tertiary">
                      {t(($) => $['nodes.humanInputV2.recipients.noResults'], { ns: 'workflow' })}
                    </div>
                  )}
                  {!loading &&
                    visibleOptions.map((option, index) => {
                      const added = selectedKeys.has(`contact:${option.id}`)
                      return (
                        <RecipientContactPreview key={option.id} contact={option}>
                          <button
                            aria-label={getOptionLabel(option)}
                            ref={
                              index ===
                              visibleOptions.findIndex(
                                (item) => !selectedKeys.has(`contact:${item.id}`),
                              )
                                ? firstOptionRef
                                : undefined
                            }
                            type="button"
                            disabled={added}
                            className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 pr-3 pl-2 text-left hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                            onClick={() => add({ type: 'contact', contact_id: option.id })}
                          >
                            <Avatar
                              avatar={option.avatar ?? null}
                              name={option.name}
                              size="sm"
                              className={cn(
                                'inset-ring-[0.5px] inset-ring-divider-regular [&>span]:text-[13px] [&>span]:font-semibold',
                                added && 'opacity-50',
                              )}
                            />
                            <span className={cn('min-w-0 grow', added && 'opacity-50')}>
                              <span className="block truncate system-sm-medium text-text-secondary">
                                {option.name}
                              </span>
                              <span className="block truncate system-xs-regular text-text-tertiary">
                                {option.email}
                              </span>
                            </span>
                            {added && (
                              <span className="system-xs-regular text-text-tertiary">
                                {t(($) => $['nodes.humanInputV2.recipients.added'], {
                                  ns: 'workflow',
                                })}
                              </span>
                            )}
                          </button>
                        </RecipientContactPreview>
                      )
                    })}
                  {hasMore && !loading && (
                    <Button
                      size="small"
                      loading={loadingMore}
                      disabled={loadingMore}
                      onClick={loadMore}
                    >
                      {t(($) => $['common.loadMore'], { ns: 'workflow' })}
                    </Button>
                  )}
                  <div className="my-1 h-px bg-divider-subtle" />
                  <button
                    type="button"
                    aria-label={t(($) => $['nodes.humanInputV2.recipients.initiator'], {
                      ns: 'workflow',
                    })}
                    disabled={selectedKeys.has('initiator')}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 pr-3 pl-2 text-left hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:opacity-50"
                    onClick={() => add({ type: 'initiator' })}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface">
                      <span className="i-ri-user-follow-line size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 grow">
                      <span className="block system-sm-medium text-util-colors-indigo-indigo-700">
                        {t(($) => $['nodes.humanInputV2.recipients.initiator'], { ns: 'workflow' })}
                      </span>
                      <span className="block system-xs-regular text-text-tertiary">
                        {t(($) => $['nodes.humanInputV2.recipients.initiatorDescription'], {
                          ns: 'workflow',
                        })}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], {
                      ns: 'workflow',
                    })}
                    disabled={selectedKeys.has('all_workspace_contacts')}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 pr-3 pl-2 text-left hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:opacity-50"
                    onClick={() => add({ type: 'all_workspace_contacts' })}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface">
                      {workspace?.name ? (
                        <WorkspaceAvatar name={workspace.name} size="sm" className="rounded-full" />
                      ) : (
                        <span className="i-ri-group-line size-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 grow">
                      <span className="block system-sm-medium text-util-colors-indigo-indigo-700">
                        {workspace?.name ||
                          t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], {
                            ns: 'workflow',
                          })}
                        {workspace?.contactCount !== undefined && (
                          <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-[5px] bg-components-badge-bg-dimm px-1 py-0.5 align-middle system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
                            {workspace.contactCount}
                          </span>
                        )}
                      </span>
                      <span className="block system-xs-regular text-text-tertiary">
                        {t(
                          ($) => $['nodes.humanInputV2.recipients.allWorkspaceContactsDescription'],
                          { ns: 'workflow' },
                        )}
                      </span>
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
              filterVar={(variable: Var) =>
                [VarType.string, VarType.secret].includes(variable.type)
              }
              trigger={
                <Button
                  variant="ghost"
                  size="small"
                  className="gap-1 pr-1.5 pl-1.25 text-text-tertiary"
                >
                  <span
                    className="i-custom-vender-line-others-global-variable size-3.5"
                    aria-hidden
                  />
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
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Infotip
                aria-label={t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
              >
                {t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
              </Infotip>
            </div>
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
                {hasMore && !loading && (
                  <Button
                    size="small"
                    loading={loadingMore}
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {t(($) => $['common.loadMore'], { ns: 'workflow' })}
                  </Button>
                )}
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

          {editor.draft.type === 'all_workspace_contacts' && (
            <div className="rounded-md bg-components-input-bg-normal px-2 py-1.5 system-xs-regular text-text-secondary">
              {t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContactsDescription'], {
                ns: 'workflow',
              })}
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
    </section>
  )
}

const RuntimeRecipients = (props: RecipientsProps) => {
  const { provider, workspaceId } = useContactRecipientOptionProvider()
  const workspace = useAtomValue(currentWorkspaceAtom)
  const canManageContacts = useAtomValue(isCurrentWorkspaceManagerAtom)
  const input = { query: { group: 'workspace' as const, page: 1, limit: 1 } }
  const contactsQuery = consoleQuery.workspaces.current.humanInput.contacts.get
  const count = useQuery({
    ...contactsQuery.queryOptions({
      input,
      queryKey: [...contactsQuery.queryKey({ input }), { workspaceId }],
      context: { silent: true },
    }),
    enabled: Boolean(workspaceId) && canManageContacts,
    select: (response) => response.total,
    retry: false,
  })
  return (
    <RecipientsContent
      key={workspaceId}
      {...props}
      readonly={props.readonly || !workspaceId}
      provider={provider}
      workspace={{ name: workspace.name, contactCount: canManageContacts ? count.data : undefined }}
    />
  )
}

const Recipients = (props: RecipientsProps) =>
  props.provider ? (
    <RecipientsContent {...props} provider={props.provider} />
  ) : (
    <RuntimeRecipients {...props} />
  )

export default Recipients
