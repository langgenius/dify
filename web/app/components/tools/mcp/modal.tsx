'use client'
import type { FC } from 'react'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AppIconType } from '@/types/app'
import { RiCloseLine, RiEditLine } from '@remixicon/react'
import { useHover } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Button from '@/app/components/base/button'
import { Mcp } from '@/app/components/base/icons/src/vender/other'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import TabSlider from '@/app/components/base/tab-slider'
import Toast from '@/app/components/base/toast'
import { MCPAuthMethod } from '@/app/components/tools/types'
import { cn } from '@/utils/classnames'
import { shouldUseMcpIconForAppIcon } from '@/utils/mcp'
import { isValidServerID, isValidUrl, useMCPModalForm } from './hooks/use-mcp-modal-form'
import AuthenticationSection from './sections/authentication-section'
import ConfigurationsSection from './sections/configurations-section'
import HeadersSection from './sections/headers-section'

export type MCPModalConfirmPayload = {
  name: string
  server_url: string
  icon_type: AppIconType
  icon: string
  icon_background?: string | null
  server_identifier: string
  headers?: Record<string, string>
  is_dynamic_registration?: boolean
  authentication?: {
    client_id?: string
    client_secret?: string
    grant_type?: string
  }
  configuration: {
    timeout: number
    sse_read_timeout: number
  }
}

export type DuplicateAppModalProps = {
  data?: ToolWithProvider
  show: boolean
  onConfirm: (info: MCPModalConfirmPayload) => void
  onHide: () => void
}

type MCPModalContentProps = {
  data?: ToolWithProvider
  onConfirm: (info: MCPModalConfirmPayload) => void
  onHide: () => void
}

const MCPModalContent: FC<MCPModalContentProps> = ({
  data,
  onConfirm,
  onHide,
}) => {
  const { t } = useTranslation()

  const {
    isCreate,
    originalServerUrl,
    originalServerID,
    appIconRef,
    state,
    actions,
  } = useMCPModalForm(data)

  const isHovering = useHover(appIconRef)

  const authMethods = [
    { text: t('mcp.modal.authentication', { ns: 'tools' }), value: MCPAuthMethod.authentication },
    { text: t('mcp.modal.headers', { ns: 'tools' }), value: MCPAuthMethod.headers },
    { text: t('mcp.modal.configurations', { ns: 'tools' }), value: MCPAuthMethod.configurations },
  ]

  const submit = async () => {
    if (!isValidUrl(state.url)) {
      Toast.notify({ type: 'error', message: 'invalid server url' })
      return
    }
    if (!isValidServerID(state.serverIdentifier.trim())) {
      Toast.notify({ type: 'error', message: 'invalid server identifier' })
      return
    }
    const formattedHeaders = state.headers.reduce((acc, item) => {
      if (item.key.trim())
        acc[item.key.trim()] = item.value
      return acc
    }, {} as Record<string, string>)

    await onConfirm({
      server_url: originalServerUrl === state.url ? '[__HIDDEN__]' : state.url.trim(),
      name: state.name,
      icon_type: state.appIcon.type,
      icon: state.appIcon.type === 'emoji' ? state.appIcon.icon : state.appIcon.fileId,
      icon_background: state.appIcon.type === 'emoji' ? state.appIcon.background : undefined,
      server_identifier: state.serverIdentifier.trim(),
      headers: Object.keys(formattedHeaders).length > 0 ? formattedHeaders : undefined,
      is_dynamic_registration: state.isDynamicRegistration,
      authentication: {
        client_id: state.clientID,
        client_secret: state.credentials,
      },
      configuration: {
        timeout: state.timeout || 30,
        sse_read_timeout: state.sseReadTimeout || 300,
      },
    })
    if (isCreate)
      onHide()
  }

  const handleIconSelect = (payload: AppIconSelection) => {
    actions.setAppIcon(payload)
    actions.setShowAppIconPicker(false)
  }

  const handleIconClose = () => {
    actions.resetIcon()
    actions.setShowAppIconPicker(false)
  }

  const isSubmitDisabled = !state.name || !state.url || !state.serverIdentifier || state.isFetchingIcon

  return (
    <>
      <div className="absolute right-5 top-5 z-10 cursor-pointer p-1.5" onClick={onHide}>
        <RiCloseLine className="h-5 w-5 text-text-tertiary" />
      </div>
      <div className="title-2xl-semi-bold relative pb-3 text-xl text-text-primary">
        {!isCreate ? t('mcp.modal.editTitle', { ns: 'tools' }) : t('mcp.modal.title', { ns: 'tools' })}
      </div>

      <div className="space-y-5 py-3">
        {/* Server URL */}
        <div>
          <div className="mb-1 flex h-6 items-center">
            <span className="system-sm-medium text-text-secondary">{t('mcp.modal.serverUrl', { ns: 'tools' })}</span>
          </div>
          <Input
            value={state.url}
            onChange={e => actions.setUrl(e.target.value)}
            onBlur={e => actions.handleUrlBlur(e.target.value.trim())}
            placeholder={t('mcp.modal.serverUrlPlaceholder', { ns: 'tools' })}
          />
          {originalServerUrl && originalServerUrl !== state.url && (
            <div className="mt-1 flex h-5 items-center">
              <span className="body-xs-regular text-text-warning">{t('mcp.modal.serverUrlWarning', { ns: 'tools' })}</span>
            </div>
          )}
        </div>

        {/* Name and Icon */}
        <div className="flex space-x-3">
          <div className="grow pb-1">
            <div className="mb-1 flex h-6 items-center">
              <span className="system-sm-medium text-text-secondary">{t('mcp.modal.name', { ns: 'tools' })}</span>
            </div>
            <Input
              value={state.name}
              onChange={e => actions.setName(e.target.value)}
              placeholder={t('mcp.modal.namePlaceholder', { ns: 'tools' })}
            />
          </div>
          <div className="pt-2" ref={appIconRef}>
            <AppIcon
              iconType={state.appIcon.type}
              icon={state.appIcon.type === 'emoji' ? state.appIcon.icon : state.appIcon.fileId}
              background={state.appIcon.type === 'emoji' ? state.appIcon.background : undefined}
              imageUrl={state.appIcon.type === 'image' ? state.appIcon.url : undefined}
              innerIcon={shouldUseMcpIconForAppIcon(state.appIcon.type, state.appIcon.type === 'emoji' ? state.appIcon.icon : '') ? <Mcp className="h-8 w-8 text-text-primary-on-surface" /> : undefined}
              size="xxl"
              className="relative cursor-pointer rounded-2xl"
              coverElement={
                isHovering
                  ? (
                      <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl bg-background-overlay-alt">
                        <RiEditLine className="size-6 text-text-primary-on-surface" />
                      </div>
                    )
                  : null
              }
              onClick={() => actions.setShowAppIconPicker(true)}
            />
          </div>
        </div>

        {/* Server Identifier */}
        <div>
          <div className="flex h-6 items-center">
            <span className="system-sm-medium text-text-secondary">{t('mcp.modal.serverIdentifier', { ns: 'tools' })}</span>
          </div>
          <div className="body-xs-regular mb-1 text-text-tertiary">{t('mcp.modal.serverIdentifierTip', { ns: 'tools' })}</div>
          <Input
            value={state.serverIdentifier}
            onChange={e => actions.setServerIdentifier(e.target.value)}
            placeholder={t('mcp.modal.serverIdentifierPlaceholder', { ns: 'tools' })}
          />
          {originalServerID && originalServerID !== state.serverIdentifier && (
            <div className="mt-1 flex h-5 items-center">
              <span className="body-xs-regular text-text-warning">{t('mcp.modal.serverIdentifierWarning', { ns: 'tools' })}</span>
            </div>
          )}
        </div>

        {/* Auth Method Tabs */}
        <TabSlider
          className="w-full"
          itemClassName={isActive => `flex-1 ${isActive && 'text-text-accent-light-mode-only'}`}
          value={state.authMethod}
          onChange={actions.setAuthMethod}
          options={authMethods}
        />

        {/* Tab Content */}
        {state.authMethod === MCPAuthMethod.authentication && (
          <AuthenticationSection
            isDynamicRegistration={state.isDynamicRegistration}
            onDynamicRegistrationChange={actions.setIsDynamicRegistration}
            clientID={state.clientID}
            onClientIDChange={actions.setClientID}
            credentials={state.credentials}
            onCredentialsChange={actions.setCredentials}
          />
        )}
        {state.authMethod === MCPAuthMethod.headers && (
          <HeadersSection
            headers={state.headers}
            onHeadersChange={actions.setHeaders}
            isCreate={isCreate}
          />
        )}
        {state.authMethod === MCPAuthMethod.configurations && (
          <ConfigurationsSection
            timeout={state.timeout}
            onTimeoutChange={actions.setTimeout}
            sseReadTimeout={state.sseReadTimeout}
            onSseReadTimeoutChange={actions.setSseReadTimeout}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-row-reverse pt-5">
        <Button disabled={isSubmitDisabled} className="ml-2" variant="primary" onClick={submit}>
          {data ? t('mcp.modal.save', { ns: 'tools' }) : t('mcp.modal.confirm', { ns: 'tools' })}
        </Button>
        <Button onClick={onHide}>{t('mcp.modal.cancel', { ns: 'tools' })}</Button>
      </div>

      {state.showAppIconPicker && (
        <AppIconPicker
          onSelect={handleIconSelect}
          onClose={handleIconClose}
        />
      )}
    </>
  )
}

/**
 * MCP Modal component for creating and editing MCP server configurations.
 *
 * Uses a keyed inner component to ensure form state resets when switching
 * between create mode and edit mode with different data.
 */
const MCPModal: FC<DuplicateAppModalProps> = ({
  data,
  show,
  onConfirm,
  onHide,
}) => {
  // Use data ID as key to reset form state when switching between items
  const formKey = data?.id ?? 'create'

  return (
    <Modal
      isShow={show}
      onClose={noop}
      className={cn('relative !max-w-[520px]', 'p-6')}
    >
      <MCPModalContent
        key={formKey}
        data={data}
        onConfirm={onConfirm}
        onHide={onHide}
      />
    </Modal>
  )
}

export default MCPModal
