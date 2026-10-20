'use client'

import type { AppPartial, UpdateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { HotkeyChord } from '@tanstack/react-hotkeys'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { formatForDisplay, matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

const SUBMIT_APP_HOTKEY = 'Mod+Enter' satisfies HotkeyChord

type AppMetadataFormProps = {
  appDetail: Pick<
    AppPartial,
    | 'name'
    | 'description'
    | 'icon_type'
    | 'icon'
    | 'icon_background'
    | 'icon_url'
    | 'use_icon_as_answer_icon'
    | 'max_active_requests'
  > &
    Partial<Pick<AppPartial, 'mode'>>
  operation: 'edit' | 'duplicate' | 'create'
  nameInputRef: React.RefObject<HTMLInputElement | null>
  isPending: boolean
  error?: string
  onSubmit: (body: UpdateAppPayload) => void
}

export function AppMetadataForm({
  appDetail,
  operation,
  nameInputRef,
  isPending,
  onSubmit,
  error,
}: AppMetadataFormProps) {
  const { t } = useTranslation(['app', 'common', 'explore'])
  const formRef = useRef<HTMLFormElement>(null)
  const [source] = useState(appDetail)
  const [selectedIcon, setSelectedIcon] = useState<IconPickerValue | null>(null)
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => data.deployment_edition,
  })
  const isEdit = operation === 'edit'
  const { data: quota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: !isEdit && deploymentEdition === 'CLOUD',
      select: (data) => data.apps,
    }),
  )
  const quotaUnavailable = !isEdit && deploymentEdition === 'CLOUD' && !quota
  const isFull =
    !isEdit &&
    deploymentEdition === 'CLOUD' &&
    !!quota &&
    quota.limit > 0 &&
    quota.size >= quota.limit
  const icon: IconPickerInputValue | undefined =
    selectedIcon ??
    (source.icon_type === 'image' && source.icon
      ? { type: 'image', fileId: source.icon, url: source.icon_url ?? '' }
      : source.icon_type === 'emoji' && source.icon
        ? { type: 'emoji', icon: source.icon, background: source.icon_background }
        : source.icon_type === 'link' && source.icon
          ? { type: 'link', url: source.icon }
          : undefined)
  return (
    <Form
      className="contents"
      ref={formRef}
      onKeyDown={(event) => {
        if (
          isPending ||
          quotaUnavailable ||
          isFull ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target) ||
          !matchesKeyboardEvent(event.nativeEvent, SUBMIT_APP_HOTKEY)
        )
          return
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) event.currentTarget.requestSubmit()
      }}
      onFormSubmit={(values, details) => {
        if (details.event.target !== formRef.current) return
        const name = typeof values.name === 'string' ? values.name : ''
        if (isPending || quotaUnavailable || isFull || !name.trim()) return
        const body: UpdateAppPayload = {
          name,
          icon_type: selectedIcon?.type ?? source.icon_type,
          icon: selectedIcon
            ? selectedIcon.type === 'emoji'
              ? selectedIcon.icon
              : selectedIcon.fileId
            : source.icon,
          icon_background: selectedIcon
            ? selectedIcon.type === 'emoji'
              ? selectedIcon.background
              : undefined
            : source.icon_background,
        }
        if (operation !== 'duplicate')
          body.description = typeof values.description === 'string' ? values.description : ''
        if (isEdit) {
          body.use_icon_as_answer_icon =
            typeof values.use_icon_as_answer_icon === 'boolean'
              ? values.use_icon_as_answer_icon
              : (source.use_icon_as_answer_icon ?? false)
          if (typeof values.max_active_requests === 'number')
            body.max_active_requests = values.max_active_requests
        }
        onSubmit(body)
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? t(($) => $.editAppTitle, { ns: 'app' })
            : operation === 'duplicate'
              ? t(($) => $.duplicateTitle, { ns: 'app' })
              : t(($) => $['appCustomize.title'], { ns: 'explore', name: source.name })}
        </DialogTitle>
        <DialogHeaderCloseButton
          disabled={isPending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <Fieldset className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          <FieldsetLegend className="col-span-2 mb-0">
            {t(($) => $['newApp.captionName'], { ns: 'app' })}
          </FieldsetLegend>
          <IconPicker value={icon} onValueChange={setSelectedIcon}>
            <IconPickerTrigger
              disabled={isPending}
              aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
            >
              <IconPickerIcon size="large" />
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
          <Field
            name="name"
            className="contents"
            validate={(value) =>
              typeof value === 'string' && !value.trim()
                ? t(($) => $['appCustomize.nameRequired'], { ns: 'explore' })
                : null
            }
          >
            <Input
              aria-label={t(($) => $['newApp.name'], { ns: 'app' })}
              ref={nameInputRef}
              defaultValue={source.name}
              readOnly={isPending}
              placeholder={t(($) => $['newApp.appNamePlaceholder'], { ns: 'app' })}
              required
            />
            <FieldError className="col-span-2" />
          </Field>
        </Fieldset>
        {operation !== 'duplicate' && (
          <Field name="description">
            <FieldLabel>{t(($) => $['newApp.captionDescription'], { ns: 'app' })}</FieldLabel>
            <Textarea
              defaultValue={source.description ?? ''}
              readOnly={isPending}
              placeholder={t(($) => $['newApp.appDescriptionPlaceholder'], { ns: 'app' })}
            />
          </Field>
        )}
        {isEdit && (
          <>
            {(source.mode === 'chat' ||
              source.mode === 'advanced-chat' ||
              source.mode === 'agent-chat') && (
              <Field name="use_icon_as_answer_icon">
                <FieldLabel>{t(($) => $['answerIcon.title'], { ns: 'app' })}</FieldLabel>
                <Switch
                  defaultChecked={source.use_icon_as_answer_icon ?? false}
                  disabled={isPending}
                />
                <FieldDescription>
                  {t(($) => $['answerIcon.descriptionInExplore'], { ns: 'app' })}
                </FieldDescription>
              </Field>
            )}
            <Field name="max_active_requests">
              <FieldLabel>{t(($) => $.maxActiveRequests, { ns: 'app' })}</FieldLabel>
              <NumberField
                min={0}
                step={1}
                smallStep={1}
                defaultValue={source.max_active_requests ?? undefined}
                readOnly={isPending}
              >
                <NumberFieldGroup>
                  <NumberFieldInput
                    placeholder={t(($) => $.maxActiveRequestsPlaceholder, { ns: 'app' })}
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
              <FieldDescription>{t(($) => $.maxActiveRequestsTip, { ns: 'app' })}</FieldDescription>
              <FieldError />
            </Field>
          </>
        )}
        {isFull && (
          <AppsFull
            loc={operation === 'duplicate' ? 'app-duplicate-create' : 'app-explore-create'}
          />
        )}
        {error && (
          <p role="alert" className="body-sm-regular text-text-destructive">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={isPending} render={<Button type="button" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          loading={isPending}
          disabled={quotaUnavailable || isFull}
        >
          {isEdit
            ? t(($) => $['operation.save'], { ns: 'common' })
            : operation === 'duplicate'
              ? t(($) => $.duplicate, { ns: 'app' })
              : t(($) => $['operation.create'], { ns: 'common' })}
          <KbdGroup>
            {formatForDisplay(SUBMIT_APP_HOTKEY, { parts: true }).map((key) => (
              <Kbd key={key} color="white">
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        </Button>
      </DialogFooter>
    </Form>
  )
}
