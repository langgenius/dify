'use client'

import type {
  AppDetailSiteResponse,
  AppDetailWithSite,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { Language } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import { PremiumBadgeButton } from '@/app/components/base/premium-badge'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { languages } from '@/i18n/language'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

type SettingsDialogProps = {
  isChat: boolean
  canDeploy?: boolean
  appInfo?: SettingsAppInfo
  disabled?: boolean
  triggerLabel?: string
  onSave: (params: AppSiteUpdatePayload) => Promise<boolean>
}

type SettingsSiteInfo = Pick<
  AppDetailSiteResponse,
  | 'title'
  | 'description'
  | 'default_language'
  | 'chat_color_theme'
  | 'chat_color_theme_inverted'
  | 'copyright'
  | 'privacy_policy'
  | 'custom_disclaimer'
  | 'input_placeholder'
  | 'icon_type'
  | 'icon'
  | 'icon_background'
  | 'icon_url'
  | 'show_workflow_steps'
  | 'use_icon_as_answer_icon'
>

type SettingsAppIconSelection =
  | IconPickerValue
  | null
  | {
      type: 'link'
      icon: string
      url: string
    }

export type SettingsAppInfo = {
  id: string
  mode: AppDetailWithSite['mode']
  site: SettingsSiteInfo
}

const INPUT_PLACEHOLDER_MAX_LENGTH = 64
const INPUT_PLACEHOLDER_SUPPORTED_MODES: ReadonlyArray<AppDetailWithSite['mode']> = [
  'chat',
  'agent-chat',
  'advanced-chat',
] as const

const prefixSettings = 'overview.appInfo.settings'
type SelectOption = {
  value: Language
  name: string
}

const LANGUAGE_OPTIONS: SelectOption[] = languages.filter((item) => item.supported)

const createInputInfo = (appInfo: SettingsAppInfo) => {
  const {
    title,
    description,
    chat_color_theme,
    chat_color_theme_inverted,
    copyright,
    privacy_policy,
    custom_disclaimer,
    input_placeholder,
    show_workflow_steps,
    use_icon_as_answer_icon,
  } = appInfo.site

  return {
    title,
    desc: description ?? '',
    chatColorTheme: chat_color_theme ?? '',
    chatColorThemeInverted: chat_color_theme_inverted,
    copyright: copyright ?? '',
    copyrightSwitchValue: !!copyright,
    privacyPolicy: privacy_policy ?? '',
    customDisclaimer: custom_disclaimer,
    inputPlaceholder: input_placeholder ?? '',
    show_workflow_steps,
    use_icon_as_answer_icon,
  }
}

const createAppIcon = (appInfo: SettingsAppInfo): SettingsAppIconSelection => {
  const { icon_type, icon, icon_background, icon_url } = appInfo.site

  if (icon_type === 'image' && icon) return { type: 'image', url: icon_url ?? '', fileId: icon }

  if (icon_type === 'link' && icon) return { type: 'link', icon, url: icon }

  if (icon_type === 'emoji' && icon && icon_background)
    return { type: 'emoji', icon, background: icon_background }

  return null
}

const getSettingsResetKey = (appInfo: SettingsAppInfo) =>
  JSON.stringify([
    appInfo.id,
    appInfo.site.title,
    appInfo.site.description,
    appInfo.site.chat_color_theme,
    appInfo.site.chat_color_theme_inverted,
    appInfo.site.copyright,
    appInfo.site.privacy_policy,
    appInfo.site.custom_disclaimer,
    appInfo.site.input_placeholder,
    appInfo.site.default_language,
    appInfo.site.icon_type,
    appInfo.site.icon,
    appInfo.site.icon_background,
    appInfo.site.icon_url,
    appInfo.site.show_workflow_steps,
    appInfo.site.use_icon_as_answer_icon,
  ])

function SettingsUpgradeButton() {
  const { t } = useTranslation(['billing'])
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  return (
    <PremiumBadgeButton size="s" color="blue" onClick={() => setPricing('open')}>
      <span
        aria-hidden="true"
        className="i-custom-public-common-sparkles-soft size-3.5 text-components-premium-badge-indigo-text-stop-0"
      />
      <span className="p-1 system-xs-medium">
        {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
      </span>
    </PremiumBadgeButton>
  )
}

function SettingsForm({
  isChat,
  canDeploy = false,
  appInfo,
  disabled,
  pending,
  onSubmit,
}: Pick<SettingsDialogProps, 'isChat' | 'canDeploy' | 'disabled'> & {
  appInfo: SettingsAppInfo
  pending: boolean
  onSubmit: (params: AppSiteUpdatePayload) => Promise<void>
}) {
  const [inputInfo, setInputInfo] = useState(() => createInputInfo(appInfo))
  const [language, setLanguage] = useState(appInfo.site.default_language)
  const { t } = useTranslation(['app', 'appOverview', 'common'])
  const [appIcon, setAppIcon] = useState<SettingsAppIconSelection>(() => createAppIcon(appInfo))
  const settingsResetKey = getSettingsResetKey(appInfo)
  const [previousSettingsResetKey, setPreviousSettingsResetKey] = useState(settingsResetKey)

  if (previousSettingsResetKey !== settingsResetKey) {
    setPreviousSettingsResetKey(settingsResetKey)
    setInputInfo(createInputInfo(appInfo))
    setLanguage(appInfo.site.default_language)
    setAppIcon(createAppIcon(appInfo))
  }

  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: webappCopyrightEnabled } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => data.webapp_copyright_enabled,
    }),
  )
  const canCustomizePlaceholder = deploymentEdition !== 'CLOUD' || webappCopyrightEnabled === true
  const selectedLanguage = LANGUAGE_OPTIONS.find((item) => item.value === language)
  const copyrightLegendId = useId()
  const copyrightDescriptionId = useId()
  const showUpgrade = deploymentEdition === 'CLOUD' && webappCopyrightEnabled === false
  const inputPlaceholderField = (
    <InputGroup>
      <InputGroupInput
        readOnly={pending}
        value={inputInfo.inputPlaceholder}
        onValueChange={(value) => setInputInfo((item) => ({ ...item, inputPlaceholder: value }))}
        maxLength={INPUT_PLACEHOLDER_MAX_LENGTH}
        autoComplete="off"
        placeholder={t(($) => $[`${prefixSettings}.more.inputPlaceholderPlaceholder`], {
          ns: 'appOverview',
        })}
        className="enabled:not-focus:text-text-placeholder"
      />
      <InputGroupAddon align="inline-end" aria-hidden="true">
        <span className="grid size-6 place-items-center rounded-md bg-components-button-primary-bg opacity-50">
          <span className="i-custom-vender-solid-communication-send-03 size-4 text-components-button-primary-text" />
        </span>
      </InputGroupAddon>
    </InputGroup>
  )

  const handleFormSubmit = async () => {
    if (pending) return
    const params = {
      title: inputInfo.title,
      description: inputInfo.desc,
      default_language: language,
      chat_color_theme: inputInfo.chatColorTheme,
      chat_color_theme_inverted: inputInfo.chatColorThemeInverted,
      prompt_public: false,
      copyright: !webappCopyrightEnabled
        ? undefined
        : inputInfo.copyrightSwitchValue
          ? inputInfo.copyright
          : '',
      privacy_policy: inputInfo.privacyPolicy,
      custom_disclaimer: inputInfo.customDisclaimer,
      input_placeholder: !canCustomizePlaceholder
        ? undefined
        : !INPUT_PLACEHOLDER_SUPPORTED_MODES.includes(appInfo.mode)
          ? ''
          : inputInfo.inputPlaceholder.slice(0, INPUT_PLACEHOLDER_MAX_LENGTH),
      icon_type: appIcon?.type ?? appInfo.site.icon_type,
      icon: appIcon
        ? appIcon.type === 'image'
          ? appIcon.fileId
          : appIcon.icon
        : appInfo.site.icon,
      icon_background: appIcon
        ? appIcon.type === 'emoji'
          ? appIcon.background
          : undefined
        : appInfo.site.icon_background,
      show_workflow_steps: inputInfo.show_workflow_steps,
      use_icon_as_answer_icon: inputInfo.use_icon_as_answer_icon,
    }
    await onSubmit(params)
  }

  return (
    <Form
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      onFormSubmit={handleFormSubmit}
    >
      {canDeploy && (
        <div className="row-start-1 px-6 py-2">
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="relative flex min-h-10 items-start gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]"
          >
            <div
              aria-hidden="true"
              className="absolute -inset-px bg-linear-to-r from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent opacity-40"
            />
            <div className="relative flex size-6 shrink-0 items-center justify-center p-1">
              <span
                aria-hidden="true"
                className="i-ri-information-2-fill size-4 text-text-accent"
              />
            </div>
            <p className="relative min-w-0 flex-1 py-1 system-xs-medium wrap-break-word text-text-primary">
              {t(($) => $[`${prefixSettings}.multiEnvironmentNotice`], {
                ns: 'appOverview',
              })}
            </p>
          </div>
        </div>
      )}

      <ScrollArea className="row-start-2 min-h-0 overflow-hidden">
        <ScrollAreaViewport className="overscroll-contain">
          <ScrollAreaContent className="flex flex-col gap-y-5 px-6 py-3" style={{ minWidth: 0 }}>
            <div className="flex gap-4">
              <Field name="title" className="grow">
                <FieldLabel>
                  {t(($) => $[`${prefixSettings}.webName`], { ns: 'appOverview' })}
                </FieldLabel>
                <Input
                  readOnly={pending}
                  required
                  value={inputInfo.title}
                  onValueChange={(value) => setInputInfo((item) => ({ ...item, title: value }))}
                  placeholder={t(($) => $.appNamePlaceholder, { ns: 'app' })}
                />
                <FieldError match="valueMissing">
                  {t(($) => $['newApp.nameNotEmpty'], { ns: 'app' })}
                </FieldError>
              </Field>
              <IconPicker
                value={
                  appIcon ??
                  (appInfo.site.icon_type === 'emoji' && appInfo.site.icon
                    ? {
                        type: 'emoji',
                        icon: appInfo.site.icon,
                        background: appInfo.site.icon_background,
                      }
                    : undefined)
                }
                onValueChange={setAppIcon}
              >
                <IconPickerTrigger
                  disabled={pending}
                  aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                  className="shrink-0 self-center rounded-2xl"
                >
                  <IconPickerIcon size="xxl" />
                </IconPickerTrigger>
                <IconPickerContent />
              </IconPicker>
            </div>

            <Field name="description">
              <FieldLabel>
                {t(($) => $[`${prefixSettings}.webDesc`], { ns: 'appOverview' })}
              </FieldLabel>
              <Textarea
                readOnly={pending}
                value={inputInfo.desc}
                onValueChange={(value) => setInputInfo((item) => ({ ...item, desc: value }))}
                placeholder={t(($) => $[`${prefixSettings}.webDescPlaceholder`], {
                  ns: 'appOverview',
                })}
              />
              <FieldDescription>
                {t(($) => $[`${prefixSettings}.webDescTip`], { ns: 'appOverview' })}
              </FieldDescription>
            </Field>
            <Separator />

            {isChat && (
              <Field name="use_icon_as_answer_icon">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>{t(($) => $['answerIcon.title'], { ns: 'app' })}</FieldLabel>
                  <Switch
                    readOnly={pending}
                    checked={inputInfo.use_icon_as_answer_icon}
                    onCheckedChange={(v) =>
                      setInputInfo((item) => ({ ...item, use_icon_as_answer_icon: v }))
                    }
                  />
                </div>
                <FieldDescription>
                  {t(($) => $['answerIcon.description'], { ns: 'app' })}
                </FieldDescription>
              </Field>
            )}
            <Field name="default_language" className="flex items-center justify-between gap-3">
              <Select<Language>
                readOnly={pending}
                value={selectedLanguage?.value ?? null}
                onValueChange={(value) => {
                  if (value !== null) setLanguage(value)
                }}
              >
                <SelectLabel>
                  {t(($) => $[`${prefixSettings}.language`], { ns: 'appOverview' })}
                </SelectLabel>
                <SelectTrigger className="w-50">
                  {selectedLanguage?.name ?? t(($) => $['placeholder.select'], { ns: 'common' })}
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <SelectItemText>{item.name}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {isChat && (
              <div className="grid gap-1">
                <Field
                  name="chat_color_theme"
                  className="items-start gap-x-3 sm:grid-cols-[minmax(0,1fr)_12.5rem]"
                >
                  <div>
                    <FieldLabel>
                      {t(($) => $[`${prefixSettings}.chatColorTheme`], { ns: 'appOverview' })}
                    </FieldLabel>
                    <FieldDescription>
                      {t(($) => $[`${prefixSettings}.chatColorThemeDesc`], { ns: 'appOverview' })}
                    </FieldDescription>
                  </div>
                  <Input
                    readOnly={pending}
                    pattern="#[A-Fa-f0-9]{6}"
                    value={inputInfo.chatColorTheme}
                    onValueChange={(value) =>
                      setInputInfo((item) => ({ ...item, chatColorTheme: value }))
                    }
                    placeholder="E.g #A020F0"
                  />
                  <FieldError match="patternMismatch" className="sm:col-start-2">
                    {t(($) => $[`${prefixSettings}.invalidHexMessage`], { ns: 'appOverview' })}
                  </FieldError>
                </Field>
                <Field
                  name="chat_color_theme_inverted"
                  className="ml-auto flex w-50 items-center justify-between gap-2"
                >
                  <FieldLabel>
                    {t(($) => $[`${prefixSettings}.chatColorThemeInverted`], { ns: 'appOverview' })}
                  </FieldLabel>
                  <Switch
                    readOnly={pending}
                    checked={inputInfo.chatColorThemeInverted}
                    onCheckedChange={(value) =>
                      setInputInfo((item) => ({ ...item, chatColorThemeInverted: value }))
                    }
                  />
                </Field>
              </div>
            )}

            <Field name="show_workflow_steps">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>
                  {t(($) => $[`${prefixSettings}.workflow.subTitle`], { ns: 'appOverview' })}
                </FieldLabel>
                <Switch
                  readOnly={pending}
                  disabled={!(appInfo.mode === 'workflow' || appInfo.mode === 'advanced-chat')}
                  checked={inputInfo.show_workflow_steps}
                  onCheckedChange={(v) =>
                    setInputInfo((item) => ({ ...item, show_workflow_steps: v }))
                  }
                />
              </div>
              <FieldDescription>
                {t(($) => $[`${prefixSettings}.workflow.showDesc`], { ns: 'appOverview' })}
              </FieldDescription>
            </Field>
            <Separator />
            {INPUT_PLACEHOLDER_SUPPORTED_MODES.includes(appInfo.mode) && (
              <Field name="input_placeholder" disabled={!canCustomizePlaceholder}>
                <div className="flex items-center gap-1">
                  <FieldLabel>
                    {t(($) => $[`${prefixSettings}.more.inputPlaceholder`], { ns: 'appOverview' })}
                  </FieldLabel>
                  {showUpgrade && <SettingsUpgradeButton />}
                </div>
                <FieldDescription>
                  {t(($) => $[`${prefixSettings}.more.inputPlaceholderTip`], { ns: 'appOverview' })}
                </FieldDescription>
                {showUpgrade ? (
                  <Tooltip>
                    <TooltipTrigger render={inputPlaceholderField} />
                    <TooltipContent className="w-45">
                      {t(($) => $[`${prefixSettings}.more.inputPlaceholderTooltip`], {
                        ns: 'appOverview',
                      })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  inputPlaceholderField
                )}
                {canCustomizePlaceholder && (
                  <FieldDescription className="text-right">
                    {`${inputInfo.inputPlaceholder.length} / ${INPUT_PLACEHOLDER_MAX_LENGTH}`}
                  </FieldDescription>
                )}
              </Field>
            )}
            <Fieldset className="grid gap-1">
              <Field name="copyright_enabled" disabled={webappCopyrightEnabled !== true}>
                <div className="flex items-center gap-1">
                  <FieldsetLegend id={copyrightLegendId} className="mb-0">
                    {t(($) => $[`${prefixSettings}.more.copyright`], { ns: 'appOverview' })}
                  </FieldsetLegend>
                  {showUpgrade && <SettingsUpgradeButton />}
                  <Tooltip>
                    <TooltipTrigger render={<div className="ml-auto" />}>
                      <Switch
                        readOnly={pending}
                        aria-labelledby={copyrightLegendId}
                        checked={inputInfo.copyrightSwitchValue}
                        onCheckedChange={(value) =>
                          setInputInfo((item) => ({ ...item, copyrightSwitchValue: value }))
                        }
                      />
                    </TooltipTrigger>
                    {webappCopyrightEnabled === false && (
                      <TooltipContent className="w-45">
                        {t(($) => $[`${prefixSettings}.more.copyrightTooltip`], {
                          ns: 'appOverview',
                        })}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
                <FieldDescription id={copyrightDescriptionId}>
                  {t(($) => $[`${prefixSettings}.more.copyrightTip`], { ns: 'appOverview' })}
                </FieldDescription>
              </Field>
              {inputInfo.copyrightSwitchValue && (
                <Field name="copyright" disabled={webappCopyrightEnabled !== true}>
                  <Input
                    readOnly={pending}
                    aria-labelledby={copyrightLegendId}
                    aria-describedby={copyrightDescriptionId}
                    value={inputInfo.copyright}
                    onValueChange={(value) =>
                      setInputInfo((item) => ({ ...item, copyright: value }))
                    }
                    placeholder={t(($) => $[`${prefixSettings}.more.copyRightPlaceholder`], {
                      ns: 'appOverview',
                    })}
                  />
                </Field>
              )}
            </Fieldset>
            <Field
              name="privacy_policy"
              validate={(value) => {
                if (typeof value === 'string' && value && !/^https?:\/\//.test(value))
                  return t(($) => $[`${prefixSettings}.invalidPrivacyPolicy`], {
                    ns: 'appOverview',
                  })
              }}
            >
              <FieldLabel>
                {t(($) => $[`${prefixSettings}.more.privacyPolicy`], { ns: 'appOverview' })}
              </FieldLabel>
              <FieldDescription>
                <Trans
                  i18nKey={($) => $[`${prefixSettings}.more.privacyPolicyTip`]}
                  ns="appOverview"
                  components={{
                    privacyPolicyLink: (
                      <Link
                        href="https://dify.ai/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-accent"
                      />
                    ),
                  }}
                />
              </FieldDescription>
              <Input
                readOnly={pending}
                value={inputInfo.privacyPolicy}
                onValueChange={(value) =>
                  setInputInfo((item) => ({ ...item, privacyPolicy: value }))
                }
                placeholder={t(($) => $[`${prefixSettings}.more.privacyPolicyPlaceholder`], {
                  ns: 'appOverview',
                })}
              />
              <FieldError />
            </Field>
            <Field name="custom_disclaimer">
              <FieldLabel>
                {t(($) => $[`${prefixSettings}.more.customDisclaimer`], { ns: 'appOverview' })}
              </FieldLabel>
              <FieldDescription>
                {t(($) => $[`${prefixSettings}.more.customDisclaimerTip`], { ns: 'appOverview' })}
              </FieldDescription>
              <Textarea
                readOnly={pending}
                value={inputInfo.customDisclaimer}
                onValueChange={(value) =>
                  setInputInfo((item) => ({ ...item, customDisclaimer: value }))
                }
                placeholder={t(($) => $[`${prefixSettings}.more.customDisclaimerPlaceholder`], {
                  ns: 'appOverview',
                })}
              />
            </Field>
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>

      <div className="row-start-3 flex justify-end gap-2 p-6 pt-5">
        <DialogClose disabled={pending} render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending} disabled={disabled}>
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </Form>
  )
}

export function SettingsDialog({
  appInfo,
  isChat,
  canDeploy,
  disabled,
  triggerLabel,
  onSave,
}: SettingsDialogProps) {
  const { t } = useTranslation(['appOverview', 'common', 'navigation'])
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const actionsRef = useRef<DialogActions>(null)
  const unavailable = disabled || !appInfo
  const trigger = (
    <Button variant="secondary" disabled={unavailable || pending} className="px-3">
      <span aria-hidden className="i-ri-equalizer-2-line size-4" />
      {triggerLabel ?? t(($) => $['settings.settings'], { ns: 'navigation' })}
    </Button>
  )

  const handleSave = async (params: AppSiteUpdatePayload) => {
    if (pendingRef.current || unavailable) return
    pendingRef.current = true
    setPending(true)
    try {
      if ((await onSave(params)) === true) actionsRef.current?.close()
    } catch {
      // Request owners report failures; keep the draft on unexpected rejection too.
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  if (!appInfo) return trigger

  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(_open, details) => {
        if (pendingRef.current && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="grid w-130 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-6 pt-6 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $[`${prefixSettings}.title`], { ns: 'appOverview' })}
          </DialogTitle>
          <DialogClose
            disabled={pending}
            render={
              <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} size="lg">
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          <DialogDescription className="col-span-2 system-xs-regular text-text-tertiary">
            {t(($) => $[`${prefixSettings}.modalTip`], { ns: 'appOverview' })}
          </DialogDescription>
        </div>
        <SettingsForm
          key={appInfo.id}
          appInfo={appInfo}
          isChat={isChat}
          canDeploy={canDeploy}
          disabled={disabled}
          pending={pending}
          onSubmit={handleSave}
        />
      </DialogContent>
    </Dialog>
  )
}
