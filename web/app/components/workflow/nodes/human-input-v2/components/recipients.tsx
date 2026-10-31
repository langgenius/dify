'use client'

import type { KeyboardEvent } from 'react'
import type { ContactRecipientOption, ContactRecipientOptionProvider } from '../contact-provider'
import type { HumanInputV2Recipient } from '../types'
import type { Node, ValueSelector, Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VariableLabelInEditor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarType } from '@/app/components/workflow/types'
import { currentWorkspaceAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { selectIMCentrallyManaged } from '@/features/contacts/im-capability'
import { consoleQuery } from '@/service/console'
import { useContactRecipientOptionProvider } from '../contact-provider'
import {
  addRecipient,
  findConflictingContact,
  getRecipientCanonicalKey,
  getRecipientValidationError,
  hasDuplicateRecipients,
  removeRecipient,
  replaceContactRecipient,
} from '../recipient-utils'
import { RecipientAvatar } from './recipient-avatar'
import { RecipientContactPreview } from './recipient-contact-preview'

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

type ContactSourceFilter = 'all' | ContactRecipientOption['source']

const contactSourceFilters: ContactSourceFilter[] = ['all', 'workspace', 'organization', 'external']

const RecipientsContent = ({
  nodeId,
  value,
  onChange,
  readonly,
  provider,
  workspace,
  availableNodes = [],
}: RecipientsProps & { provider: ContactRecipientOptionProvider }) => {
  const { t } = useTranslation(['workflow', 'contacts'])
  const [open, setOpen] = useState(false)
  const [searchFromInput, setSearchFromInput] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ContactRecipientOption[]>([])
  const [sourceFilter, setSourceFilter] = useState<ContactSourceFilter>('all')
  const centrallyManagedQuery = useQuery(
    consoleQuery.features.get.queryOptions({
      select: selectIMCentrallyManaged,
      retry: false,
    }),
  )
  const centrallyManaged = centrallyManagedQuery.isSuccess && centrallyManagedQuery.data === true
  const availableSourceFilters = contactSourceFilters.filter(
    (filter) => filter !== 'organization' || centrallyManaged,
  )
  const activeSourceFilter =
    sourceFilter === 'organization' && !centrallyManaged ? 'all' : sourceFilter
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
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const recipientInputRef = useRef<HTMLInputElement>(null)
  const variableTriggerRef = useRef<HTMLButtonElement>(null)

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
      activeSourceFilter === 'all'
        ? options
        : options.filter((option) => option.source === activeSourceFilter),
    [options, activeSourceFilter],
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

  useEffect(() => {
    // The editor-safe endpoint paginates all sources together. Keep looking until the
    // selected source has a result, or the server confirms that no later page exists.
    if (
      !open ||
      activeSourceFilter === 'all' ||
      visibleOptions.length > 0 ||
      !hasMore ||
      loading ||
      loadingMore ||
      loadError
    )
      return

    void loadOptions(searchQueryRef.current, searchPage + 1)
  }, [
    hasMore,
    loadError,
    loadOptions,
    loading,
    loadingMore,
    open,
    searchPage,
    activeSourceFilter,
    visibleOptions.length,
  ])

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
    if (recipient.type === 'contact') {
      const option = options.find((option) => option.id === recipient.contact_id)
      if (option && findConflictingContact(value, option, resolvedOptions)) return
    }
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

  const replaceContact = (previousContactId: string, nextContact: ContactRecipientOption) => {
    const nextValue = replaceContactRecipient(value, previousContactId, nextContact.id)
    if (nextValue === value) return
    setResolvedOptions((current) => [
      ...current.filter((item) => item.id !== previousContactId && item.id !== nextContact.id),
      nextContact,
    ])
    onChange(nextValue)
    setEmailDraft('')
    setQuery('')
    setEmailError(false)
    setOpen(false)
  }

  const addOneTimeEmail = () => {
    const recipients: HumanInputV2Recipient[] = emailDraft.split(',').map((email) => ({
      type: 'onetime_email',
      email: email.trim(),
    }))
    const invalid = recipients.some((recipient) => !!getRecipientValidationError(recipient))
    const duplicate =
      hasDuplicateRecipients(recipients) ||
      recipients.some((recipient) => selectedKeys.has(getRecipientCanonicalKey(recipient) || ''))
    setEmailError(invalid || duplicate)
    if (invalid || duplicate) return
    onChange([...value, ...recipients])
    setEmailDraft('')
    setQuery('')
    setOpen(false)
  }

  const getRecipientLabel = (recipient: HumanInputV2Recipient) => {
    if (recipient.type === 'all_workspace_contacts')
      return (
        workspace?.name ||
        t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], { ns: 'workflow' })
      )
    if (recipient.type === 'initiator')
      return t(($) => $['nodes.humanInputV2.recipients.type.initiator'], { ns: 'workflow' })
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
        <Infotip>
          <InfotipTrigger
            aria-label={t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })}
          />
          <InfotipContent>
            {t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
          </InfotipContent>
        </Infotip>
      </div>

      <div
        className={cn(
          'min-h-20 rounded-lg bg-components-input-bg-normal focus-within:ring-1 focus-within:ring-components-input-border-active',
          readonly && 'opacity-70',
        )}
      >
        <div
          className="flex min-h-11 flex-wrap content-start items-start gap-1 px-2 pt-2 pb-0.5"
          aria-live="polite"
        >
          {recipientRows.map(({ recipient, index, key }) => {
            const contact =
              recipient.type === 'contact' ? resolvedMap.get(recipient.contact_id) : undefined
            const invalidEmail =
              recipient.type === 'onetime_email' && !!getRecipientValidationError(recipient)
            const invalid =
              !!getRecipientValidationError(recipient) ||
              (hasDuplicateRecipients(value) &&
                value.findIndex(
                  (item) => getRecipientCanonicalKey(item) === getRecipientCanonicalKey(recipient),
                ) !== index)
            const chipClassName = cn(
              'flex h-5 max-w-full items-center gap-1 rounded-full bg-components-badge-white-to-dark p-0.5 system-xs-regular text-text-primary shadow-xs inset-ring-[0.5px] inset-ring-components-panel-border-subtle',
              (recipient.type === 'initiator' || recipient.type === 'all_workspace_contacts') &&
                'bg-util-colors-indigo-indigo-100 font-medium text-util-colors-indigo-indigo-700 inset-ring-util-colors-indigo-indigo-200',
              recipient.type === 'dynamic_email' &&
                'rounded-[5px] bg-util-colors-blue-blue-50 text-text-accent',
              invalid && 'bg-state-destructive-hover text-text-destructive',
              !readonly &&
                'focus-within:bg-util-colors-blue-blue-50 focus-within:inset-ring-1 focus-within:inset-ring-state-accent-solid',
            )
            const label = contact ? getOptionLabel(contact) : getRecipientLabel(recipient)
            const removeChip = () => {
              onChange(removeRecipient(value, index))
              setSearchFromInput(true)
              setOpen(false)
              recipientInputRef.current?.focus()
            }
            const handleChipKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
              if (
                event.nativeEvent.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                (event.key !== 'Backspace' && event.key !== 'Delete')
              )
                return
              event.preventDefault()
              event.stopPropagation()
              if (event.repeat) return
              removeChip()
            }
            const chipContent = (
              <>
                {invalidEmail && (
                  <span
                    className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive"
                    aria-hidden
                  />
                )}
                {recipient.type === 'onetime_email' && !invalidEmail && (
                  <RecipientAvatar
                    identity={recipient.email.trim().toLowerCase()}
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
                  <>
                    <span aria-hidden="true" className="flex shrink-0">
                      <RecipientAvatar
                        identity={contact.id}
                        avatar={contact.avatar ?? null}
                        name={contact.name}
                        size="xxs"
                        className="[&>span]:text-[10px]"
                      />
                    </span>
                    <span className="max-w-[260px] truncate px-0.5">{contact.name}</span>
                  </>
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
                    <span className="pe-1 text-text-tertiary">{workspace.contactCount}</span>
                  )}
                {invalid && (
                  <span className="sr-only">
                    {t(($) => $['nodes.humanInputV2.error.recipientInvalid'], {
                      ns: 'workflow',
                    })}
                  </span>
                )}
              </>
            )
            const chip =
              readonly && !contact && !invalidEmail ? (
                <span className="flex min-w-0 items-center gap-1">{chipContent}</span>
              ) : (
                <button
                  type="button"
                  aria-label={label}
                  aria-keyshortcuts={readonly ? undefined : 'Backspace Delete'}
                  className="flex min-w-0 items-center gap-1 rounded-[inherit] border-0 text-start focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                  onKeyDown={readonly ? undefined : handleChipKeyDown}
                >
                  {chipContent}
                </button>
              )
            const preview = invalidEmail ? (
              <Tooltip>
                <TooltipTrigger render={chip} />
                <TooltipContent>
                  {t(($) => $['nodes.humanInputV2.recipients.emailInvalidOrDuplicate'], {
                    ns: 'workflow',
                  })}
                </TooltipContent>
              </Tooltip>
            ) : contact ? (
              <RecipientContactPreview contact={contact} selectOnClick={!readonly}>
                {chip}
              </RecipientContactPreview>
            ) : (
              chip
            )
            return (
              <span key={key} className={chipClassName}>
                {preview}
                {!readonly && (
                  <IconButton
                    size="xs"
                    className="shrink-0"
                    aria-label={t(($) => $['nodes.humanInputV2.recipients.remove'], {
                      ns: 'workflow',
                      recipient: label,
                    })}
                    aria-keyshortcuts="Backspace Delete"
                    onKeyDown={handleChipKeyDown}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeChip()
                    }}
                  >
                    <span aria-hidden className="i-ri-close-line size-3" />
                  </IconButton>
                )}
              </span>
            )
          })}
          {!readonly && (
            <>
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
                  if (readonly || event.nativeEvent.isComposing) return
                  if (
                    event.key === 'Backspace' &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey &&
                    emailDraft === '' &&
                    value.length > 0
                  ) {
                    event.preventDefault()
                    event.stopPropagation()
                    if (event.repeat) return
                    const lastIndex = value.length - 1
                    onChange(removeRecipient(value, lastIndex))
                    setSearchFromInput(true)
                    setOpen(false)
                    return
                  }
                  if (event.key === '/' && !emailDraft.trim()) {
                    event.preventDefault()
                    variableTriggerRef.current?.click()
                    return
                  }
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
                      !searchValue.includes(',') &&
                      !loading &&
                      !loadError &&
                      searchQueryRef.current === emailDraft &&
                      visibleOptions.find(
                        (option) =>
                          !selectedKeys.has(`contact:${option.id}`) &&
                          !findConflictingContact(value, option, resolvedOptions) &&
                          (!searchValue.includes('@') ||
                            option.email.toLowerCase() === searchValue),
                      )
                    if (option) add({ type: 'contact', contact_id: option.id })
                    else addOneTimeEmail()
                  }
                }}
                placeholder={
                  value.length
                    ? ''
                    : t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                        ns: 'workflow',
                      })
                }
                aria-invalid={emailError}
                aria-describedby={emailError ? `${nodeId}-recipient-email-error` : undefined}
                // oxlint-disable-next-line shadcn/no-restyle -- The enclosing recipient editor paints the shared focus ring around its chips and input.
                className="h-5 w-0 min-w-4 grow basis-4 rounded-none border-0 bg-transparent px-1 py-0 shadow-none hover:bg-transparent focus:bg-transparent focus:shadow-none focus:ring-0"
              />
              {emailDraft.includes('@') && (
                <Button size="small" onClick={addOneTimeEmail}>
                  {t(($) => $['nodes.humanInputV2.recipients.addEmail'], { ns: 'workflow' })}
                </Button>
              )}
            </>
          )}
        </div>
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
          <div className="flex min-h-9 items-center gap-1 py-1.5 ps-1.5 pe-2.5">
            <Popover open={open} onOpenChange={handleOpenChange}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="small"
                    className="gap-1 ps-1.25 pe-1.5 text-text-tertiary"
                  >
                    <span className="i-ri-account-circle-line size-3.5" aria-hidden />
                    {t(($) => $['nodes.humanInputV2.recipients.addContact'], { ns: 'workflow' })}
                  </Button>
                }
              />
              <PopoverContent
                initialFocus={searchFromInput ? false : undefined}
                finalFocus={searchFromInput ? recipientInputRef : undefined}
                side="bottom"
                align="start"
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
                              (option) =>
                                !selectedKeys.has(`contact:${option.id}`) &&
                                !findConflictingContact(value, option, resolvedOptions),
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
                  {availableSourceFilters.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      role="tab"
                      aria-selected={activeSourceFilter === filter}
                      className={cn(
                        'shrink-0 rounded-md border-0 bg-transparent px-2 py-1 system-xs-medium text-text-tertiary focus-visible:ring-1 focus-visible:ring-state-accent-solid',
                        activeSourceFilter === filter &&
                          'bg-state-base-hover-alt text-text-primary',
                      )}
                      onClick={() => setSourceFilter(filter)}
                    >
                      {filter === 'organization'
                        ? t(($) => $['type.platform'], { ns: 'contacts' })
                        : t(($) => $[`nodes.humanInputV2.recipients.contactSource.${filter}`], {
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
                      const conflict = findConflictingContact(value, option, resolvedOptions)
                      const conflictingContact = conflict ? resolvedMap.get(conflict.id) : undefined
                      return (
                        <RecipientContactPreview
                          key={option.id}
                          contact={option}
                          conflictingContact={conflictingContact}
                          onReplace={
                            conflictingContact
                              ? () => replaceContact(conflictingContact.id, option)
                              : undefined
                          }
                        >
                          <button
                            aria-label={getOptionLabel(option)}
                            ref={
                              index ===
                              visibleOptions.findIndex(
                                (item) =>
                                  !selectedKeys.has(`contact:${item.id}`) &&
                                  !findConflictingContact(value, item, resolvedOptions),
                              )
                                ? firstOptionRef
                                : undefined
                            }
                            type="button"
                            disabled={added}
                            aria-disabled={!!conflictingContact || undefined}
                            className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 ps-2 pe-3 text-start hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
                            onClick={() => {
                              if (!conflictingContact)
                                add({ type: 'contact', contact_id: option.id })
                            }}
                          >
                            <RecipientAvatar
                              identity={option.id}
                              avatar={option.avatar ?? null}
                              name={option.name}
                              size="sm"
                              className={cn(
                                'inset-ring-[0.5px] inset-ring-divider-regular [&>span]:text-[13px] [&>span]:font-semibold',
                                (added || conflictingContact) && 'opacity-50',
                              )}
                            />
                            <span
                              className={cn(
                                'min-w-0 grow',
                                (added || conflictingContact) && 'opacity-50',
                              )}
                            >
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
                            {conflictingContact && (
                              <span
                                className="i-ri-lock-line size-3 shrink-0 text-text-tertiary"
                                aria-hidden
                              />
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
                  {(activeSourceFilter === 'all' || activeSourceFilter === 'workspace') && (
                    <div className="my-1 h-px bg-divider-subtle" />
                  )}
                  {activeSourceFilter === 'all' && (
                    <button
                      type="button"
                      aria-label={t(($) => $['nodes.humanInputV2.recipients.type.initiator'], {
                        ns: 'workflow',
                      })}
                      disabled={selectedKeys.has('initiator')}
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 ps-2 pe-3 text-start hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:opacity-50"
                      onClick={() => add({ type: 'initiator' })}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface">
                        <span className="i-ri-user-follow-line size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 grow">
                        <span className="block system-sm-medium text-util-colors-indigo-indigo-700">
                          {t(($) => $['nodes.humanInputV2.recipients.type.initiator'], {
                            ns: 'workflow',
                          })}
                        </span>
                        <span className="block system-xs-regular text-text-tertiary">
                          {t(($) => $['nodes.humanInputV2.recipients.initiator'], {
                            ns: 'workflow',
                          })}
                        </span>
                      </span>
                    </button>
                  )}
                  {(activeSourceFilter === 'all' || activeSourceFilter === 'workspace') && (
                    <button
                      type="button"
                      aria-label={t(
                        ($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'],
                        {
                          ns: 'workflow',
                        },
                      )}
                      disabled={selectedKeys.has('all_workspace_contacts')}
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg border-0 bg-transparent py-1 ps-2 pe-3 text-start hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:opacity-50"
                      onClick={() => add({ type: 'all_workspace_contacts' })}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface">
                        {workspace?.name ? (
                          <WorkspaceAvatar
                            name={workspace.name}
                            size="sm"
                            className="rounded-full"
                          />
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
                            <span className="ms-0.5 inline-flex min-w-4 items-center justify-center rounded-[5px] bg-components-badge-bg-dimm px-1 py-0.5 align-middle system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
                              {workspace.contactCount}
                            </span>
                          )}
                        </span>
                        <span className="block system-xs-regular text-text-tertiary">
                          {t(
                            ($) =>
                              $['nodes.humanInputV2.recipients.allWorkspaceContactsDescription'],
                            { ns: 'workflow' },
                          )}
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <VarReferencePicker
              nodeId={nodeId}
              readonly={readonly}
              value={[]}
              isShowNodeName
              filterVar={(variable: Var) =>
                variable.type === VarType.string || variable.type === VarType.secret
              }
              trigger={
                <Button
                  ref={variableTriggerRef}
                  variant="ghost"
                  size="small"
                  className="gap-1 ps-1.25 pe-1.5 text-text-tertiary"
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
            <div className="ms-auto flex shrink-0 items-center gap-1">
              <Infotip>
                <InfotipTrigger
                  aria-label={t(($) => $['nodes.humanInputV2.recipients.title'], {
                    ns: 'workflow',
                  })}
                />
                <InfotipContent>
                  {t(($) => $['nodes.humanInputV2.recipients.inputHelp'], { ns: 'workflow' })}
                </InfotipContent>
              </Infotip>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

const RuntimeRecipients = (props: RecipientsProps) => {
  const { provider, workspaceId } = useContactRecipientOptionProvider()
  const workspace = useAtomValue(currentWorkspaceAtom)
  const canManageContacts = useAtomValue(isCurrentWorkspaceManagerAtom)
  const input = { query: { group: 'workspace' as const, page: 1, limit: 1 } }
  const contactsQuery = consoleQuery.workspaces.current.humanInput.v2.contacts.get
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
