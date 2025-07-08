import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import Authorize from '../authorize'
import type { Credential } from '../types'
import { CredentialTypeEnum } from '../types'
import ApiKeyModal from '../authorize/api-key-modal'
import Item from './item'
import {
  useDeletePluginToolCredential,
  useInvalidPluginToolCredentialInfo,
  useSetPluginToolDefaultCredential,
} from '@/service/use-plugins-auth'
import { useToastContext } from '@/app/components/base/toast'

type AuthorizedProps = {
  provider: string
  credentials: Credential[]
  canOAuth?: boolean
  canApiKey?: boolean
  disabled?: boolean
}
const Authorized = ({
  provider,
  credentials,
  canOAuth,
  canApiKey,
  disabled,
}: AuthorizedProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [isOpen, setIsOpen] = useState(false)
  const oAuthCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.OAUTH2)
  const apiKeyCredentials = credentials.filter(credential => credential.credential_type === CredentialTypeEnum.API_KEY)
  const pendingOperationCredentialId = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const { mutateAsync: deletePluginToolCredential } = useDeletePluginToolCredential(provider)
  const invalidatePluginToolCredentialInfo = useInvalidPluginToolCredentialInfo(provider)
  const openConfirm = useCallback((credentialId?: string) => {
    if (credentialId)
      pendingOperationCredentialId.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const closeConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
  }, [])
  const handleConfirm = useCallback(async () => {
    if (!pendingOperationCredentialId.current) {
      setDeleteCredentialId(null)
      return
    }

    await deletePluginToolCredential({ credential_id: pendingOperationCredentialId.current })
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    invalidatePluginToolCredentialInfo()
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
  }, [deletePluginToolCredential, invalidatePluginToolCredentialInfo, notify, t])
  const [editValues, setEditValues] = useState<Record<string, any> | null>(null)
  const handleEdit = useCallback((id: string, values: Record<string, any>) => {
    pendingOperationCredentialId.current = id
    setEditValues(values)
  }, [])
  const handleRemove = useCallback(() => {
    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const { mutateAsync: setPluginToolDefaultCredential } = useSetPluginToolDefaultCredential(provider)
  const handleSetDefault = useCallback(async (id: string) => {
    await setPluginToolDefaultCredential(id)
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    invalidatePluginToolCredentialInfo()
  }, [setPluginToolDefaultCredential, invalidatePluginToolCredentialInfo, notify, t])

  return (
    <>
      <PortalToFollowElem
        open={isOpen}
        onOpenChange={setIsOpen}
        placement='bottom-start'
        offset={8}
        triggerPopupSameWidth
      >
        <PortalToFollowElemTrigger
          onClick={() => setIsOpen(!isOpen)}
          asChild
        >
          <Button
            className={cn(
              'w-full',
              isOpen && 'bg-components-button-secondary-bg-hover',
            )}>
            <Indicator className='mr-2' />
            {credentials.length} Authorizations
            <RiArrowDownSLine className='ml-0.5 h-4 w-4' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[100]'>
          <div className='max-h-[360px] overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
            <div className='py-1'>
              {
                !!oAuthCredentials.length && (
                  <div className='p-1'>
                    <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
                      OAuth
                    </div>
                    {
                      oAuthCredentials.map(credential => (
                        <Item
                          key={credential.id}
                          credential={credential}
                        />
                      ))
                    }
                  </div>
                )
              }
              {
                !!apiKeyCredentials.length && (
                  <div className='p-1'>
                    <div className='system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary'>
                      API Keys
                    </div>
                    {
                      apiKeyCredentials.map(credential => (
                        <Item
                          key={credential.id}
                          credential={credential}
                          disabled={disabled}
                          onDelete={openConfirm}
                          onEdit={handleEdit}
                          onSetDefault={handleSetDefault}
                        />
                      ))
                    }
                  </div>
                )
              }
            </div>
            <div className='h-[1px] bg-divider-subtle'></div>
            <div className='p-2'>
              <Authorize
                provider={provider}
                theme='secondary'
                showDivider={false}
                canOAuth={canOAuth}
                canApiKey={canApiKey}
                disabled={disabled}
              />
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      {
        deleteCredentialId && (
          <Confirm
            isShow
            title='Are you sure?'
            content='content'
            onCancel={closeConfirm}
            onConfirm={handleConfirm}
          />
        )
      }
      {
        !!editValues && (
          <ApiKeyModal
            provider={provider}
            editValues={editValues}
            onClose={() => {
              setEditValues(null)
              pendingOperationCredentialId.current = null
            }}
            onRemove={handleRemove}
          />
        )
      }
    </>
  )
}

export default memo(Authorized)
