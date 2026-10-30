'use client'

import type { ContactOption } from '@dify/contracts/api/console/workspaces/types.gen'
import type { HumanInputV2Recipient } from '../types'
import type { Node, Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxRow,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VariableLabelInEditor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarType } from '@/app/components/workflow/types'
import {
  currentWorkspaceAtom,
  currentWorkspaceIdAtom,
  isCurrentWorkspaceManagerAtom,
} from '@/context/workspace-state'
import { selectIMCentrallyManaged } from '@/features/contacts/im-capability'
import { consoleQuery } from '@/service/console'
import { getContactRecipientQueryOptions } from '../contact-queries'
import {
  addRecipient,
  findConflictingContact,
  getRecipientCanonicalKey,
  getRecipientValidationError,
  hasDuplicateRecipients,
  replaceContactRecipient,
} from '../recipient-utils'
import { RecipientAvatar } from './recipient-avatar'
import { RecipientContactPreview } from './recipient-contact-preview'

type RecipientsProps = {
  nodeId: string
  value: HumanInputV2Recipient[]
  onChange: (value: HumanInputV2Recipient[]) => void
  readonly: boolean
  availableNodes?: Node[]
}
type SourceFilter = 'all' | 'workspace' | 'organization' | 'external'
type RecipientItem = {
  key: string
  label: string
  recipient: HumanInputV2Recipient
  contact?: ContactOption
}
const sourceFilters: SourceFilter[] = ['all', 'workspace', 'organization', 'external']
const getContactLabel = (contact: ContactOption) =>
  contact.email ? `${contact.name} · ${contact.email}` : contact.name

const RecipientsContent = ({
  nodeId,
  value,
  onChange,
  readonly,
  availableNodes = [],
  workspaceId,
  workspace,
}: RecipientsProps & {
  workspaceId: string
  workspace: { name: string; contactCount?: number }
}) => {
  const { t } = useTranslation(['workflow', 'contacts', 'common'])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const keyword = useDebounce(query.trim(), { wait: 300 })
  const isDebouncing = keyword !== query.trim()
  const [source, setSource] = useState<SourceFilter>('all')
  const [emailError, setEmailError] = useState(false)
  const [highlighted, setHighlighted] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const variableTriggerRef = useRef<HTMLButtonElement>(null)
  const contactIds = value.flatMap((recipient) =>
    recipient.type === 'contact' ? [recipient.contact_id] : [],
  )
  const resolved = useQuery(getContactRecipientQueryOptions(workspaceId, contactIds))
  const features = useQuery(
    consoleQuery.features.get.queryOptions({ select: selectIMCentrallyManaged, retry: false }),
  )
  const centrallyManaged = features.isSuccess && features.data
  const activeSource = source === 'organization' && !centrallyManaged ? 'all' : source
  const operation = consoleQuery.workspaces.current.humanInput.v2.contactOptions.get
  const searchInput = workspaceId
    ? (page: number) => ({ query: { keyword, page, limit: 20 } })
    : skipToken
  const search = useInfiniteQuery(
    operation.infiniteOptions({
      input: searchInput,
      queryKey: [
        ...operation.infiniteKey({ input: searchInput, initialPageParam: 1 }),
        { workspaceId },
      ],
      initialPageParam: 1,
      getNextPageParam: (page) => (page.page * page.limit < page.total ? page.page + 1 : undefined),
      enabled: open,
      context: { silent: true },
      retry: false,
    }),
  )
  const { selectedItems, results, itemMap, items } = useMemo(() => {
    const contacts = search.data?.pages.flatMap((page) => page.data) ?? []
    const selectedContacts = resolved.data?.data ?? []
    const contactMap = new Map(
      [...contacts, ...selectedContacts].map((contact) => [contact.id, contact]),
    )
    const labelFor = (recipient: HumanInputV2Recipient) => {
      switch (recipient.type) {
        case 'contact':
          return contactMap.has(recipient.contact_id)
            ? getContactLabel(contactMap.get(recipient.contact_id)!)
            : recipient.contact_id
        case 'initiator':
          return t(($) => $['nodes.humanInputV2.recipients.type.initiator'], { ns: 'workflow' })
        case 'all_workspace_contacts':
          return (
            workspace.name ||
            t(($) => $['nodes.humanInputV2.recipients.allWorkspaceContacts'], { ns: 'workflow' })
          )
        case 'onetime_email':
          return recipient.email
        case 'dynamic_email':
          return [
            availableNodes.find((node) => node.id === recipient.selector[0])?.data.title,
            ...recipient.selector.slice(1),
          ]
            .filter(Boolean)
            .join(' / ')
      }
    }
    const occurrences = new Map<string, number>()
    const selectedItems: RecipientItem[] = value.map((recipient, index) => {
      const canonical = getRecipientCanonicalKey(recipient) ?? `invalid:${index}`
      const occurrence = occurrences.get(canonical) ?? 0
      occurrences.set(canonical, occurrence + 1)
      return {
        key: occurrence ? `${canonical}:duplicate:${occurrence}` : canonical,
        label: labelFor(recipient),
        recipient,
        contact: recipient.type === 'contact' ? contactMap.get(recipient.contact_id) : undefined,
      }
    })
    const specialRecipients: HumanInputV2Recipient[] =
      activeSource === 'all'
        ? [{ type: 'initiator' }, { type: 'all_workspace_contacts' }]
        : activeSource === 'workspace'
          ? [{ type: 'all_workspace_contacts' }]
          : []
    const results: RecipientItem[] = [
      ...contacts
        .filter(
          (contact) =>
            activeSource === 'all' ||
            contact.type === (activeSource === 'organization' ? 'platform' : activeSource),
        )
        .map((contact) => ({
          key: `contact:${contact.id}`,
          label: getContactLabel(contact),
          recipient: { type: 'contact' as const, contact_id: contact.id },
          contact,
        })),
      ...specialRecipients
        .filter(
          (recipient) =>
            !query.trim() ||
            labelFor(recipient).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
        .map((recipient) => ({ key: recipient.type, label: labelFor(recipient), recipient })),
    ]
    const itemMap = new Map([...results, ...selectedItems].map((item) => [item.key, item]))
    const items = createComboboxItems([...itemMap.values()], {
      getValue: (item) => item.key,
      getLabel: (item) => item.label,
    })
    return { selectedItems, results, itemMap, items }
  }, [search.data, resolved.data, value, activeSource, query, availableNodes, t, workspace.name])
  const selectedContacts = selectedItems.flatMap((item) => (item.contact ? [item.contact] : []))
  const selectedKeys = selectedItems.map((item) => item.key)
  const commit = (next: HumanInputV2Recipient[]) => {
    if (readonly) return
    onChange(next)
    setQuery('')
    setEmailError(false)
    setOpen(false)
  }
  const addEmail = () => {
    const additions: HumanInputV2Recipient[] = query
      .split(',')
      .map((email) => ({ type: 'onetime_email', email: email.trim() }))
    if (
      additions.some((recipient) => getRecipientValidationError(recipient)) ||
      hasDuplicateRecipients([...value, ...additions])
    ) {
      setEmailError(true)
      inputRef.current?.focus()
      return
    }
    commit([...value, ...additions])
    inputRef.current?.focus()
  }
  const infoName = (name: string) =>
    t(($) => $['nodes.humanInputV2.recipients.contactInfo'], { ns: 'workflow', name })
  const inputHint = t(($) => $['nodes.humanInputV2.recipients.selectionHint'], {
    ns: 'workflow',
    count: value.length,
  })
  const invalidMessage = t(($) => $['nodes.humanInputV2.error.recipientInvalid'], {
    ns: 'workflow',
  })

  return (
    <div className="px-4 pt-2">
      <div className="mb-1 flex min-h-6 items-center gap-0.5">
        <h3
          id={`${nodeId}-recipients-label`}
          className="system-sm-semibold-uppercase text-text-secondary"
        >
          {t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })}
        </h3>
        <Infotip>
          <InfotipTrigger
            aria-label={t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
          />
          <InfotipContent>
            {t(($) => $['nodes.humanInputV2.recipients.help'], { ns: 'workflow' })}
          </InfotipContent>
        </Infotip>
      </div>
      <Combobox<string, true, RecipientItem>
        multiple
        grid
        modal={false}
        readOnly={readonly}
        items={items}
        filteredItems={isDebouncing ? [] : results}
        filter={null}
        value={selectedKeys}
        inputValue={query}
        open={open}
        onOpenChange={(next) => {
          if (!readonly) {
            setOpen(next)
            if (!next) setQuery('')
          }
        }}
        onInputValueChange={(next) => {
          setQuery(next)
          setEmailError(false)
        }}
        onItemHighlighted={setHighlighted}
        onValueChange={(next, details) => {
          if (readonly || details.reason === 'escape-key') {
            details.cancel()
            return
          }
          const added = next.find((key) => !selectedKeys.includes(key))
          if (added) {
            const item = itemMap.get(added)
            if (!item) return
            if (
              item.contact &&
              findConflictingContact(
                value,
                { id: item.contact.id, email: item.contact.email ?? '' },
                selectedContacts.map((contact) => ({ ...contact, email: contact.email ?? '' })),
              )
            )
              return
            commit(addRecipient(value, item.recipient))
          } else {
            onChange(
              selectedItems.filter((item) => next.includes(item.key)).map((item) => item.recipient),
            )
            if (details.reason !== 'item-press') setOpen(false)
          }
        }}
      >
        <ComboboxInputGroup
          className={cn('min-h-20 flex-col items-stretch py-2', readonly && 'opacity-70')}
        >
          <ComboboxValue<string, true>>
            {() => (
              <ComboboxChips
                aria-label={
                  value.length
                    ? t(($) => $['nodes.humanInputV2.recipients.title'], { ns: 'workflow' })
                    : undefined
                }
              >
                {selectedItems.map((item, index) => {
                  const recipient = item.recipient
                  const invalid =
                    !!getRecipientValidationError(recipient) ||
                    value.findIndex(
                      (other) =>
                        getRecipientCanonicalKey(other) === getRecipientCanonicalKey(recipient),
                    ) !== index ||
                    (recipient.type === 'contact' &&
                      resolved.isSuccess &&
                      !(resolved.data?.data ?? []).some(
                        (contact) => contact.id === recipient.contact_id,
                      ))
                  return (
                    <ComboboxChip
                      key={item.key}
                      aria-label={item.label}
                      aria-description={
                        readonly
                          ? undefined
                          : t(($) => $['nodes.humanInputV2.recipients.removeHint'], {
                              ns: 'workflow',
                            })
                      }
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${nodeId}-invalid-${index}` : undefined}
                      className="rounded-full aria-invalid:bg-state-destructive-hover aria-invalid:text-text-destructive data-[recipient-type=all_workspace_contacts]:bg-util-colors-indigo-indigo-100 data-[recipient-type=all_workspace_contacts]:text-util-colors-indigo-indigo-700 data-[recipient-type=dynamic_email]:bg-util-colors-blue-blue-50 data-[recipient-type=dynamic_email]:text-text-accent data-[recipient-type=initiator]:bg-util-colors-indigo-indigo-100 data-[recipient-type=initiator]:text-util-colors-indigo-indigo-700"
                      data-recipient-type={recipient.type}
                    >
                      {recipient.type === 'initiator' && (
                        <span
                          className="flex size-4 shrink-0 items-center justify-center rounded-full bg-util-colors-indigo-indigo-500 text-text-primary-on-surface"
                          aria-hidden
                        >
                          <span className="i-ri-user-follow-line size-3" />
                        </span>
                      )}
                      {recipient.type === 'onetime_email' && !invalid && (
                        <RecipientAvatar
                          identity={recipient.email.trim().toLocaleLowerCase()}
                          name={recipient.email}
                          size="xxs"
                        />
                      )}
                      {invalid && (
                        <span className="i-ri-error-warning-fill size-3.5 shrink-0" aria-hidden />
                      )}
                      {item.contact && (
                        <RecipientAvatar
                          identity={item.contact.id}
                          name={item.contact.name}
                          avatar={item.contact.avatar_url}
                          size="xxs"
                        />
                      )}
                      {recipient.type === 'all_workspace_contacts' && workspace.name && (
                        <span aria-hidden>
                          <WorkspaceAvatar name={workspace.name} size="xs" />
                        </span>
                      )}
                      {recipient.type === 'dynamic_email' ? (
                        <VariableLabelInEditor
                          variables={recipient.selector}
                          nodeType={
                            availableNodes.find((node) => node.id === recipient.selector[0])?.data
                              .type
                          }
                          nodeTitle={
                            availableNodes.find((node) => node.id === recipient.selector[0])?.data
                              .title
                          }
                        />
                      ) : (
                        <span className="max-w-65 truncate">
                          {item.contact?.name ?? item.label}
                        </span>
                      )}
                      {recipient.type === 'all_workspace_contacts' &&
                        workspace.contactCount !== undefined && (
                          <span>{workspace.contactCount}</span>
                        )}
                      {invalid && (
                        <span id={`${nodeId}-invalid-${index}`} className="sr-only">
                          {invalidMessage}
                        </span>
                      )}
                      {item.contact && (
                        <RecipientContactPreview contact={item.contact}>
                          <IconButton size="xs" aria-label={infoName(item.contact.name)}>
                            <span className="i-ri-information-line size-3" aria-hidden />
                          </IconButton>
                        </RecipientContactPreview>
                      )}
                      {!readonly && (
                        <ComboboxChipRemove
                          aria-label={t(($) => $['nodes.humanInputV2.recipients.remove'], {
                            ns: 'workflow',
                            recipient: item.label,
                          })}
                        />
                      )}
                    </ComboboxChip>
                  )
                })}
                {!readonly && (
                  <ComboboxInput
                    ref={inputRef}
                    aria-label={t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                      ns: 'workflow',
                    })}
                    aria-describedby={`${nodeId}-selection-hint${emailError ? ` ${nodeId}-recipient-email-error` : ''}`}
                    aria-invalid={emailError}
                    placeholder={
                      value.length
                        ? ''
                        : t(($) => $['nodes.humanInputV2.recipients.placeholder'], {
                            ns: 'workflow',
                          })
                    }
                    className="min-w-4 py-0.5"
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      // oxlint-disable-next-line typescript/no-deprecated -- Safari can report 229 without isComposing while confirming IME text.
                      if (event.nativeEvent.keyCode === 229) return
                      if (event.key === '/' && !query.trim()) {
                        event.preventDefault()
                        variableTriggerRef.current?.click()
                      }
                      if (
                        event.key === 'Enter' &&
                        query.trim() &&
                        (!open || !highlighted) &&
                        !event.defaultPrevented
                      ) {
                        event.preventDefault()
                        const candidate =
                          !query.includes(',') &&
                          !isDebouncing &&
                          !search.isFetching &&
                          !search.isError &&
                          results.find(
                            (item) =>
                              !value.some(
                                (recipient) =>
                                  getRecipientCanonicalKey(recipient) ===
                                  getRecipientCanonicalKey(item.recipient),
                              ) &&
                              (!query.includes('@') ||
                                item.contact?.email?.toLocaleLowerCase() ===
                                  query.trim().toLocaleLowerCase()),
                          )
                        if (
                          candidate &&
                          (!candidate.contact ||
                            !findConflictingContact(
                              value,
                              { id: candidate.contact.id, email: candidate.contact.email ?? '' },
                              selectedContacts.map((contact) => ({
                                ...contact,
                                email: contact.email ?? '',
                              })),
                            ))
                        )
                          commit(addRecipient(value, candidate.recipient))
                        else addEmail()
                      }
                    }}
                  />
                )}
              </ComboboxChips>
            )}
          </ComboboxValue>
          <p id={`${nodeId}-selection-hint`} className="sr-only">
            {inputHint}
          </p>
          {emailError && (
            <p
              id={`${nodeId}-recipient-email-error`}
              role="alert"
              className="px-1 system-xs-regular text-text-destructive"
            >
              {t(($) => $['nodes.humanInputV2.recipients.emailInvalidOrDuplicate'], {
                ns: 'workflow',
              })}
            </p>
          )}
          {!value.length && readonly && (
            <p className="px-1 system-xs-regular text-text-tertiary">
              {t(($) => $['nodes.humanInputV2.recipients.empty'], { ns: 'workflow' })}
            </p>
          )}
          {!readonly && (
            <div className="flex items-center gap-1 pt-1">
              <ComboboxTrigger
                render={
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setSource('all')
                      inputRef.current?.focus()
                    }}
                  >
                    <span className="i-ri-account-circle-line size-3.5" aria-hidden />
                    {t(($) => $['nodes.humanInputV2.recipients.addContact'], { ns: 'workflow' })}
                  </Button>
                }
              />
              <VarReferencePicker
                nodeId={nodeId}
                readonly={readonly}
                value={[]}
                isShowNodeName
                filterVar={(variable: Var) =>
                  variable.type === VarType.string || variable.type === VarType.secret
                }
                trigger={
                  <Button ref={variableTriggerRef} variant="ghost" size="small">
                    <span
                      className="i-custom-vender-line-others-global-variable size-3.5"
                      aria-hidden
                    />
                    {t(($) => $['nodes.humanInputV2.recipients.insertVariable'], {
                      ns: 'workflow',
                    })}
                  </Button>
                }
                onChange={(selector) => {
                  if (Array.isArray(selector))
                    commit(addRecipient(value, { type: 'dynamic_email', selector }))
                }}
              />
              {!open && query.includes('@') && (
                <Button size="small" onClick={addEmail}>
                  {t(($) => $['nodes.humanInputV2.recipients.addEmail'], { ns: 'workflow' })}
                </Button>
              )}
              <Infotip>
                <InfotipTrigger
                  className="ms-auto"
                  aria-label={t(($) => $['nodes.humanInputV2.recipients.inputHelp'], {
                    ns: 'workflow',
                  })}
                />
                <InfotipContent>
                  {t(($) => $['nodes.humanInputV2.recipients.inputHelp'], { ns: 'workflow' })}
                </InfotipContent>
              </Infotip>
            </div>
          )}
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner align="start">
            <ComboboxPopup>
              <SegmentedControl<SourceFilter>
                aria-label={t(($) => $['nodes.humanInputV2.recipients.contactSourceLabel'], {
                  ns: 'workflow',
                })}
                value={activeSource}
                onValueChange={setSource}
                className="m-1 shrink-0 overflow-x-auto"
              >
                {sourceFilters
                  .filter((filter) => filter !== 'organization' || centrallyManaged)
                  .map((filter) => (
                    <SegmentedControlItem key={filter} value={filter}>
                      {filter === 'organization'
                        ? t(($) => $['type.platform'], { ns: 'contacts' })
                        : t(($) => $[`nodes.humanInputV2.recipients.contactSource.${filter}`], {
                            ns: 'workflow',
                          })}
                    </SegmentedControlItem>
                  ))}
              </SegmentedControl>
              <ComboboxStatus>
                {isDebouncing || search.isPending
                  ? t(($) => $['nodes.humanInputV2.recipients.loading'], { ns: 'workflow' })
                  : search.isError
                    ? t(($) => $['nodes.humanInputV2.recipients.loadError'], { ns: 'workflow' })
                    : t(($) => $['nodes.humanInputV2.recipients.resultCount'], {
                        ns: 'workflow',
                        count: results.length,
                      })}
              </ComboboxStatus>
              <ComboboxList<RecipientItem>>
                {(item) => {
                  const added = value.some(
                    (recipient) =>
                      getRecipientCanonicalKey(recipient) ===
                      getRecipientCanonicalKey(item.recipient),
                  )
                  const conflict =
                    item.contact &&
                    findConflictingContact(
                      value,
                      { id: item.contact.id, email: item.contact.email ?? '' },
                      selectedContacts.map((contact) => ({
                        ...contact,
                        email: contact.email ?? '',
                      })),
                    )
                  return (
                    <ComboboxRow key={item.key} className="flex items-center">
                      <ComboboxItem<string>
                        value={item.key}
                        disabled={added || !!conflict}
                        className="min-w-0 grow"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {item.contact && (
                            <RecipientAvatar
                              identity={item.contact.id}
                              name={item.contact.name}
                              avatar={item.contact.avatar_url}
                              size="sm"
                            />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate system-sm-medium">
                              {item.contact?.name ?? item.label}
                            </span>
                            {item.contact?.email && (
                              <span className="block truncate system-xs-regular text-text-tertiary">
                                {item.contact.email}
                              </span>
                            )}
                          </span>
                          {conflict && (
                            <span className="sr-only">
                              {t(($) => $['nodes.humanInputV2.recipients.emailAlreadySelected'], {
                                ns: 'workflow',
                              })}
                            </span>
                          )}
                        </span>
                        <ComboboxItemIndicator />
                      </ComboboxItem>
                      {item.contact && (
                        <RecipientContactPreview
                          contact={item.contact}
                          conflictingContact={
                            conflict
                              ? selectedContacts.find((contact) => contact.id === conflict.id)
                              : undefined
                          }
                          onReplace={
                            conflict
                              ? () =>
                                  commit(
                                    replaceContactRecipient(value, conflict.id, item.contact!.id),
                                  )
                              : undefined
                          }
                        >
                          <IconButton aria-label={infoName(item.contact.name)}>
                            <span className="i-ri-information-line size-4" aria-hidden />
                          </IconButton>
                        </RecipientContactPreview>
                      )}
                    </ComboboxRow>
                  )
                }}
              </ComboboxList>
              {query.includes('@') && (
                <Button size="small" onClick={addEmail}>
                  {t(($) => $['nodes.humanInputV2.recipients.addEmail'], { ns: 'workflow' })}
                </Button>
              )}
              {search.isError && (
                <Button size="small" onClick={() => void search.refetch()}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              )}
              {(search.hasNextPage || (search.data?.pages.length ?? 0) > 1) && (
                <Button
                  size="small"
                  loading={search.isFetchingNextPage}
                  aria-disabled={!search.hasNextPage || search.isFetchingNextPage}
                  onClick={() => {
                    if (search.hasNextPage && !search.isFetchingNextPage)
                      void search.fetchNextPage()
                  }}
                >
                  {t(($) => $['common.loadMore'], { ns: 'workflow' })}
                </Button>
              )}
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  )
}

const Recipients = (props: RecipientsProps) => {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const workspace = useAtomValue(currentWorkspaceAtom)
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const operation = consoleQuery.workspaces.current.humanInput.v2.contacts.get
  const input =
    workspaceId && canManage
      ? { query: { group: 'workspace' as const, page: 1, limit: 1 } }
      : skipToken
  const count = useQuery(
    operation.queryOptions({
      input,
      queryKey: [...operation.queryKey({ input }), { workspaceId }],
      select: (response) => response.total,
      context: { silent: true },
      retry: false,
    }),
  )
  return (
    <RecipientsContent
      key={workspaceId}
      {...props}
      readonly={props.readonly || !workspaceId}
      workspaceId={workspaceId}
      workspace={{ name: workspace.name, contactCount: canManage ? count.data : undefined }}
    />
  )
}

export default Recipients
