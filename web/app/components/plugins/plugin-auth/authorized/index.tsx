import type { Credential, PluginPayload } from '../types'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import Authorize from '../authorize'
import { CredentialTypeEnum } from '../types'
import AuthorizedModals from './authorized-modals'
import CredentialSection, { ExtraCredentialSection } from './credential-section'
import { useCredentialActions, useModalState } from './hooks'

type AuthorizedProps = {
  pluginPayload: PluginPayload
  credentials: Credential[]
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
  renderTrigger?: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: PortalToFollowElemOptions['offset']
  placement?: PortalToFollowElemOptions['placement']
  triggerPopupSameWidth?: boolean
  popupClassName?: string
  disableSetDefault?: boolean
  onItemClick?: (id: string) => void
  extraAuthorizationItems?: Credential[]
  showItemSelectedIcon?: boolean
  selectedCredentialId?: string
  onUpdate?: () => void
  notAllowCustomCredential?: boolean
}

const Authorized = ({
  pluginPayload,
  credentials,
  canOAuth,
  canApiKey,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-start',
  triggerPopupSameWidth = true,
  popupClassName,
  disableSetDefault,
  onItemClick,
  extraAuthorizationItems,
  showItemSelectedIcon,
  selectedCredentialId,
  onUpdate,
  notAllowCustomCredential,
}: AuthorizedProps) => {
  const { t } = useTranslation()

  // Dropdown open state
  const [isLocalOpen, setIsLocalOpen] = useState(false)
  const mergedIsOpen = isOpen ?? isLocalOpen
  const setMergedIsOpen = useCallback((open: boolean) => {
    onOpenChange?.(open)
    setIsLocalOpen(open)
  }, [onOpenChange])

  // Credential actions hook
  const {
    doingAction,
    doingActionRef,
    pendingOperationCredentialIdRef,
    handleSetDefault,
    handleRename,
    handleDelete,
  } = useCredentialActions({ pluginPayload, onUpdate })

  // Modal state management hook
  const {
    deleteCredentialId,
    openDeleteConfirm,
    closeDeleteConfirm,
    editValues,
    openEditModal,
    closeEditModal,
    handleRemoveFromEdit,
  } = useModalState({ pendingOperationCredentialIdRef })

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (doingActionRef.current || !pendingOperationCredentialIdRef.current)
      return
    await handleDelete(pendingOperationCredentialIdRef.current)
    closeDeleteConfirm()
  }, [doingActionRef, pendingOperationCredentialIdRef, handleDelete, closeDeleteConfirm])

  // Filter credentials by type
  const { oAuthCredentials, apiKeyCredentials } = useMemo(() => ({
    oAuthCredentials: credentials.filter(c => c.credential_type === CredentialTypeEnum.OAUTH2),
    apiKeyCredentials: credentials.filter(c => c.credential_type === CredentialTypeEnum.API_KEY),
  }), [credentials])

  // Unavailable credentials info
  const { unavailableCredentials, hasUnavailableDefault } = useMemo(() => ({
    unavailableCredentials: credentials.filter(c => c.not_allowed_to_use),
    hasUnavailableDefault: credentials.some(c => c.not_allowed_to_use && c.is_default),
  }), [credentials])

  return (
    <>
      <PortalToFollowElem
        open={mergedIsOpen}
        onOpenChange={setMergedIsOpen}
        placement={placement}
        offset={offset}
        triggerPopupSameWidth={triggerPopupSameWidth}
      >
        <PortalToFollowElemTrigger
          onClick={() => setMergedIsOpen(!mergedIsOpen)}
          asChild
        >
          {renderTrigger
            ? renderTrigger(mergedIsOpen)
            : (
                <Button
                  className={cn(
                    'w-full',
                    isOpen && 'bg-components-button-secondary-bg-hover',
                  )}
                >
                  <Indicator className="mr-2" color={hasUnavailableDefault ? 'gray' : 'green'} />
                  {credentials.length}
                  &nbsp;
                  {credentials.length > 1
                    ? t('auth.authorizations', { ns: 'plugin' })
                    : t('auth.authorization', { ns: 'plugin' })}
                  {!!unavailableCredentials.length && (
                    ` (${unavailableCredentials.length} ${t('auth.unavailable', { ns: 'plugin' })})`
                  )}
                  <RiArrowDownSLine className="ml-0.5 h-4 w-4" />
                </Button>
              )}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[100]">
          <div className={cn(
            'max-h-[360px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}
          >
            <div className="py-1">
              <ExtraCredentialSection
                credentials={extraAuthorizationItems}
                disabled={disabled}
                onItemClick={onItemClick}
                showSelectedIcon={showItemSelectedIcon}
                selectedCredentialId={selectedCredentialId}
              />
              <CredentialSection
                title="OAuth"
                credentials={oAuthCredentials}
                disabled={disabled}
                disableEdit
                disableSetDefault={disableSetDefault}
                showSelectedIcon={showItemSelectedIcon}
                selectedCredentialId={selectedCredentialId}
                onDelete={openDeleteConfirm}
                onSetDefault={handleSetDefault}
                onRename={handleRename}
                onItemClick={onItemClick}
              />
              <CredentialSection
                title="API Keys"
                credentials={apiKeyCredentials}
                disabled={disabled}
                disableRename
                disableSetDefault={disableSetDefault}
                showSelectedIcon={showItemSelectedIcon}
                selectedCredentialId={selectedCredentialId}
                onDelete={openDeleteConfirm}
                onEdit={openEditModal}
                onSetDefault={handleSetDefault}
                onRename={handleRename}
                onItemClick={onItemClick}
              />
            </div>
            {!notAllowCustomCredential && (
              <>
                <div className="h-[1px] bg-divider-subtle"></div>
                <div className="p-2">
                  <Authorize
                    pluginPayload={pluginPayload}
                    theme="secondary"
                    showDivider={false}
                    canOAuth={canOAuth}
                    canApiKey={canApiKey}
                    disabled={disabled}
                    onUpdate={onUpdate}
                  />
                </div>
              </>
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      <AuthorizedModals
        pluginPayload={pluginPayload}
        deleteCredentialId={deleteCredentialId}
        doingAction={doingAction}
        onDeleteConfirm={handleDeleteConfirm}
        onDeleteCancel={closeDeleteConfirm}
        editValues={editValues}
        disabled={disabled}
        onEditClose={closeEditModal}
        onRemove={handleRemoveFromEdit}
        onUpdate={onUpdate}
      />
    </>
  )
}

export default memo(Authorized)
