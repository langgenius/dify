'use client'

import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import type { ContactIMIdentity, ContactView } from './types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { ContactChannelIcon } from './channel-icon'
import { getContactChannelLabel } from './channel-utils'
import { useContactsFeatureContext, useContactsManagementRepository } from './composition-context'
import { useContactIMIdentities, useRemoveContactIMBinding, useSetContactIMBinding } from './hooks'
import { formatContactRelativeTime } from './relative-time'
import { ContactIMRequestError } from './repository'

export function ContactAvatar({
  avatar,
  className,
  name,
  size = 'md',
}: Omit<AvatarProps, 'onLoadingStatusChange'>) {
  return (
    <AvatarRoot
      size={size}
      className={cn('data-loading:bg-background-section-burn', className)}
      render={(props, { imageLoadingStatus }) => (
        <span
          {...props}
          data-loading={
            avatar && (imageLoadingStatus === 'idle' || imageLoadingStatus === 'loading')
              ? ''
              : undefined
          }
        />
      )}
    >
      {avatar && <AvatarImage src={avatar} alt={name} />}
      <AvatarFallback
        size={size}
        render={(props, { imageLoadingStatus }) => (
          <span {...props}>
            {(!avatar || imageLoadingStatus === 'error') && name?.[0]?.toLocaleUpperCase()}
          </span>
        )}
      />
    </AvatarRoot>
  )
}

function imErrorKey(error: unknown, loading = false) {
  const code = error instanceof ContactIMRequestError ? error.code : undefined
  if (code === 'im_integration_not_configured') return 'imBinding.notConfigured'
  if (code === 'im_binding_conflict') return 'imBinding.conflict'
  if (
    code === 'contact_not_found' ||
    code === 'im_identity_not_found' ||
    code === 'im_binding_not_found'
  )
    return 'imBinding.notFound'
  return loading ? 'imBinding.loadFailed' : 'imBinding.failed'
}

const imIdentityAvatarColors = [
  'bg-components-icon-bg-blue-solid',
  'bg-components-icon-bg-blue-light-solid',
  'bg-components-icon-bg-indigo-solid',
  'bg-components-icon-bg-violet-solid',
  'bg-components-icon-bg-green-solid',
  'bg-components-icon-bg-teal-solid',
  'bg-components-icon-bg-pink-solid',
  'bg-components-icon-bg-orange-dark-solid',
  'bg-components-icon-bg-red-solid',
  'bg-components-icon-bg-orange-solid',
  'bg-components-icon-bg-midnight-solid',
] as const

function IMIdentityAvatar({
  identity,
  size = 'sm',
}: {
  identity: ContactIMIdentity
  size?: 'xs' | 'sm'
}) {
  const name = identity.display_name || identity.email || identity.provider_user_id
  const colorIndex = [...identity.id].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0,
  )
  return (
    <AvatarRoot
      size={size}
      className={cn(
        'border border-divider-regular',
        imIdentityAvatarColors[colorIndex % imIdentityAvatarColors.length],
      )}
    >
      <AvatarFallback
        size={size}
        className={cn(
          'bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100 leading-[1.2] font-semibold',
          size === 'sm' ? 'text-[13px]' : 'text-xs',
        )}
      >
        <span className="bg-linear-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-transparent opacity-90 text-shadow-[0_0.25px_0.5px_rgb(0_0_0/0.2)]">
          {name[0]?.toLocaleUpperCase()}
        </span>
      </AvatarFallback>
    </AvatarRoot>
  )
}

function ContactIMBindingEditor({
  contact,
  saving,
  error,
  onSave,
}: {
  contact: ContactView
  saving: boolean
  error: unknown
  onSave: (identityId: string) => void
}) {
  const { t } = useTranslation('contacts')
  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [identity, setIdentity] = useState<ContactIMIdentity | null>(null)
  const identities = useContactIMIdentities(search)
  const options = [
    ...new Map(
      (identities.data?.pages.flatMap((page) => page.data) ?? []).map((identity) => [
        identity.id,
        identity,
      ]),
    ).values(),
  ]
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (identity && !saving) onSave(identity.id)
      }}
      className="relative flex flex-col"
    >
      <div className="pt-6 pr-14 pb-3 pl-6">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['imBinding.title'])}
        </DialogTitle>
        <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
          {contact.im_bindings.length > 0
            ? t(($) => $['imBinding.overrideDescription'])
            : t(($) => $['imBinding.description'])}
        </DialogDescription>
      </div>
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['action.close'])}
            size="lg"
            className="absolute top-5 right-5"
            disabled={saving}
          >
            <span aria-hidden className="i-ri-close-line size-4.5" />
          </IconButton>
        }
      />
      <div className="px-6 py-3">
        <Combobox
          items={options}
          filter={null}
          highlightItemOnHover={false}
          value={identity}
          onValueChange={setIdentity}
          inputValue={search}
          onInputValueChange={setSearch}
          open={pickerOpen}
          onOpenChange={(nextOpen) => {
            setPickerOpen(nextOpen)
            if (nextOpen) setSearch('')
          }}
          itemToStringLabel={(item) => item.display_name || item.email || item.provider_user_id}
          isItemEqualToValue={(item, value) => item.id === value.id}
          disabled={saving}
        >
          <ComboboxLabel className="mb-1 min-h-6">
            {t(($) => $['imBinding.contactLabel'])}
          </ComboboxLabel>
          <ComboboxTrigger className="p-1 pr-2">
            {identity ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <IMIdentityAvatar identity={identity} size="xs" />
                </span>
                <span className="truncate">
                  {identity.display_name || identity.email || identity.provider_user_id}
                </span>
              </span>
            ) : (
              <span className="px-2 text-components-input-text-placeholder">
                {t(($) => $['imBinding.select'])}
              </span>
            )}
          </ComboboxTrigger>
          <ComboboxPortal>
            <ComboboxPositioner>
              <ComboboxPopup
                aria-label={t(($) => $['imBinding.contactLabel'])}
                className="w-93.5 bg-components-panel-bg-blur backdrop-blur-[5px]"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setPickerOpen(false)
                  }
                }}
              >
                <div className="p-2 pb-1">
                  <ComboboxInputGroup className="h-8 border-0 shadow-none hover:bg-components-input-bg-normal has-[input:focus]:bg-components-input-bg-normal has-[input:focus]:shadow-none has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-state-accent-solid data-focused:bg-components-input-bg-normal data-focused:shadow-none data-popup-open:bg-components-input-bg-normal">
                    <span
                      aria-hidden
                      className="ml-2 i-ri-search-line size-4 shrink-0 text-text-quaternary"
                    />
                    <ComboboxInput
                      aria-label={t(($) => $['imBinding.search'])}
                      placeholder={t(($) => $['imBinding.search'])}
                      className="h-8 py-0 pl-1.5"
                    />
                  </ComboboxInputGroup>
                </div>
                <ComboboxStatus>
                  {identities.isPending ? t(($) => $['imBinding.loading']) : null}
                </ComboboxStatus>
                {identities.isError && (
                  <div className="px-3 py-2">
                    <p role="alert" className="system-xs-regular text-text-destructive">
                      {t(($) => $[imErrorKey(identities.error, true)])}
                    </p>
                    <Button
                      className="mt-2"
                      onClick={() => {
                        void identities.refetch()
                      }}
                    >
                      {t(($) => $['action.retry'])}
                    </Button>
                  </div>
                )}
                {!identities.isPending && !identities.isError && options.length === 0 && (
                  <p className="px-3 py-2 system-xs-regular text-text-tertiary">
                    {t(($) => $['imBinding.empty'])}
                  </p>
                )}
                <ComboboxList<ContactIMIdentity>>
                  {(option) => (
                    <ComboboxItem
                      key={option.id}
                      value={option}
                      className="flex h-8 gap-2 py-1 pr-3 pl-2"
                    >
                      <IMIdentityAvatar identity={option} />
                      <span className="min-w-0 flex-1 truncate system-sm-medium">
                        {option.display_name || option.email || option.provider_user_id}
                      </span>
                      <span className="max-w-1/2 shrink-0 truncate text-right system-xs-regular text-text-quaternary">
                        {option.email || option.provider_user_id}
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
                {identities.hasNextPage && (
                  <div className="p-2 pt-1">
                    <Button
                      className="w-full"
                      loading={identities.isFetchingNextPage}
                      onClick={() => {
                        void identities.fetchNextPage()
                      }}
                    >
                      {t(($) => $['action.loadMore'])}
                    </Button>
                  </div>
                )}
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxPortal>
        </Combobox>
        {Boolean(error) && (
          <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
            {t(($) => $[imErrorKey(error)])}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 px-6 pt-5 pb-6">
        <DialogClose render={<Button className="min-w-18" disabled={saving} />}>
          {t(($) => $['action.cancel'])}
        </DialogClose>
        <Button
          type="submit"
          className="min-w-18"
          variant="primary"
          loading={saving}
          disabled={!identity}
        >
          {t(($) => $['imBinding.save'])}
        </Button>
      </div>
    </form>
  )
}

function ContactIMChannels({
  contact,
  canManage,
  removing,
}: {
  contact: ContactView
  canManage: boolean
  removing: boolean
}) {
  const { t } = useTranslation('contacts')
  const context = useContactsFeatureContext()
  const repository = useContactsManagementRepository()
  const [open, setOpen] = useState(false)
  const save = useSetContactIMBinding()
  const remove = useRemoveContactIMBinding()
  const canBind =
    canManage &&
    context.deployment !== 'ee' &&
    repository.supportsIMBindings === true &&
    contact.type !== 'external'
  const busy = save.isPending || remove.isPending || removing
  const bindings = contact.type === 'external' ? [] : contact.im_bindings
  const channels = [{ id: 'email', provider: 'email' }, ...bindings]
  function openEditor() {
    save.reset()
    remove.reset()
    setOpen(true)
  }
  return (
    <div className="p-4">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-1">
        <div className="flex items-center gap-0.5">
          <h3 className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['details.channels'])}
          </h3>
          <Infotip aria-label={t(($) => $['details.channels'])}>
            {t(($) => $['details.channelsHelp'])}
          </Infotip>
        </div>
        {canBind && bindings.length === 0 && (
          <div className="px-1">
            <IconButton
              aria-label={t(($) => $['imBinding.add'])}
              size="md"
              disabled={busy}
              onClick={openEditor}
            >
              <span aria-hidden className="i-ri-add-line size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <div className="space-y-1">
        {channels.map((channel) => {
          const label = getContactChannelLabel(channel.provider)
          const binding = bindings.find((item) => item.id === channel.id)
          return (
            <div
              key={channel.id}
              className="group/channel flex min-h-8 items-center gap-1 rounded-lg bg-components-panel-on-panel-item-bg p-1 shadow-xs inset-ring-[0.5px] inset-ring-components-panel-border focus-within:bg-components-panel-on-panel-item-bg-hover hover:bg-components-panel-on-panel-item-bg-hover"
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5 p-0.5">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <ContactChannelIcon provider={channel.provider} />
                </span>
                <span className="truncate system-sm-medium text-text-secondary" title={label}>
                  {label}
                </span>
              </div>
              {binding && canBind && (
                <div className="flex items-center gap-1 opacity-0 group-focus-within/channel:opacity-100 group-hover/channel:opacity-100 [@media(hover:none)]:opacity-100">
                  <IconButton
                    aria-label={t(($) => $['imBinding.edit'])}
                    size="md"
                    disabled={busy}
                    onClick={openEditor}
                  >
                    <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                  </IconButton>
                  <IconButton
                    aria-label={
                      binding.scope === 'workspace'
                        ? t(($) => $['imBinding.reset'])
                        : t(($) => $['imBinding.remove'])
                    }
                    size="md"
                    disabled={busy}
                    onClick={() => remove.mutate({ contactId: contact.id, binding })}
                  >
                    <span
                      aria-hidden
                      className={
                        binding.scope === 'workspace'
                          ? 'i-ri-refresh-line size-4'
                          : 'i-ri-delete-bin-line size-4'
                      }
                    />
                  </IconButton>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {remove.isError && (
        <p role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {t(($) => $[imErrorKey(remove.error)])}
        </p>
      )}
      {context.deployment === 'ee' && contact.type !== 'external' && (
        <p className="mt-2 system-xs-regular text-text-tertiary">
          {t(($) => $['imBinding.enterpriseReadOnly'])}
        </p>
      )}
      <Dialog
        open={open && canBind}
        onOpenChange={(nextOpen) => {
          if (!save.isPending) setOpen(nextOpen)
        }}
      >
        <DialogContent className="w-104 p-0">
          <ContactIMBindingEditor
            contact={contact}
            saving={save.isPending}
            error={save.error}
            onSave={(identityId) =>
              save.mutate(
                { contactId: contact.id, identityId, override: bindings.length > 0 },
                { onSuccess: () => setOpen(false) },
              )
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ContactDetailsPanel({
  contact,
  canManage = true,
  removing = false,
  onEdit,
  onClose,
  onRemove,
}: {
  contact: ContactView
  canManage?: boolean
  removing?: boolean
  onEdit: () => void
  onClose: () => void
  onRemove: () => void
}) {
  const { i18n, t } = useTranslation('contacts')

  return (
    <aside
      aria-label={t(($) => $['details.title'])}
      className="relative z-20 flex h-full w-80 max-w-full shrink-0 flex-col overflow-hidden rounded-lg bg-components-panel-bg"
    >
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {canManage && contact.type !== 'workspace' && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['details.more'])}
                  className="data-popup-open:bg-state-base-hover"
                  size="lg"
                  disabled={removing}
                >
                  <span aria-hidden className="i-ri-more-fill size-4" />
                </IconButton>
              }
            />
            <DropdownMenuContent className="min-w-32">
              {contact.type === 'external' && (
                <DropdownMenuItem className="gap-2" onClick={onEdit}>
                  <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
                  {t(($) => $['details.edit'])}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" className="gap-2" onClick={onRemove}>
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['details.remove'])}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <IconButton aria-label={t(($) => $['action.close'])} size="lg" onClick={onClose}>
          <span aria-hidden className="i-ri-close-line size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex flex-col items-center gap-2 px-4 pt-10 pb-4 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-1 top-1 h-25 overflow-hidden rounded-lg"
          >
            <ContactAvatar
              avatar={contact.avatar_url || null}
              className="absolute -top-19 left-1/2 size-80 -translate-x-1/2 opacity-20 blur-[80px]"
              name={contact.name}
              size="3xl"
            />
            <span className="absolute top-5.5 left-1/2 size-31 -translate-x-1/2 rounded-full border border-divider-subtle opacity-60" />
            <span className="absolute top-1.5 left-1/2 size-39 -translate-x-1/2 rounded-full border border-divider-subtle opacity-40" />
          </div>
          <div className="relative size-24 shrink-0 rounded-full border-2 border-components-panel-bg">
            <ContactAvatar
              avatar={contact.avatar_url || null}
              className="size-full inset-ring-[0.5px] inset-ring-divider-regular"
              name={contact.name}
              size="3xl"
            />
          </div>
          <div className="relative flex w-full flex-col items-center gap-0.5">
            <h2 className="max-w-full system-xl-medium wrap-anywhere text-text-primary">
              {contact.name}
            </h2>
            {contact.email && (
              <p className="max-w-full system-xs-regular break-all text-text-tertiary">
                {contact.email}
              </p>
            )}
          </div>
          <span className="relative inline-flex min-w-4 items-center justify-center rounded-[5px] bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary inset-ring-1 inset-ring-divider-deep">
            {t(($) => $[`type.${contact.type}`])}
          </span>
        </div>
        <div aria-hidden="true" className="flex h-4 items-center">
          <div className="h-px w-full bg-divider-subtle" />
        </div>
        <ContactIMChannels
          key={contact.id}
          contact={contact}
          canManage={canManage}
          removing={removing}
        />
      </div>
      <p className="shrink-0 px-4 py-4 system-xs-regular text-text-tertiary">
        {t(($) => $['details.joined'])}{' '}
        {formatContactRelativeTime(contact.created_at, i18n.resolvedLanguage ?? 'en')}
      </p>
    </aside>
  )
}
