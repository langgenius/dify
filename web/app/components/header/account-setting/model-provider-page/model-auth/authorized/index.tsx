import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type {
  PortalToFollowElemOptions,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import Item from './item'
import { useToastContext } from '@/app/components/base/toast'
import type { Credential } from '../../declarations'
import {
  useDeleteModelCredential,
  useSetModelCredentialDefault,
} from '@/service/use-models'

type AuthorizedProps = {
  provider: string
  credentials: Credential[]
  disabled?: boolean
  renderTrigger?: (open?: boolean) => React.ReactNode
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  offset?: PortalToFollowElemOptions['offset']
  placement?: PortalToFollowElemOptions['placement']
  triggerPopupSameWidth?: boolean
  popupClassName?: string
  onItemClick?: (id: string) => void
  showItemSelectedIcon?: boolean
  selectedCredentialId?: string
  onUpdate?: () => void
  onSetup: (credential?: Credential) => void
}
const Authorized = ({
  provider,
  credentials,
  disabled,
  renderTrigger,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = 'bottom-end',
  triggerPopupSameWidth = false,
  popupClassName,
  onItemClick,
  showItemSelectedIcon,
  selectedCredentialId,
  onUpdate,
  onSetup,
}: AuthorizedProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [isLocalOpen, setIsLocalOpen] = useState(false)
  const mergedIsOpen = isOpen ?? isLocalOpen
  const setMergedIsOpen = useCallback((open: boolean) => {
    if (onOpenChange)
      onOpenChange(open)

    setIsLocalOpen(open)
  }, [onOpenChange])
  const pendingOperationCredentialId = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const openConfirm = useCallback((credentialId?: string) => {
    if (credentialId)
      pendingOperationCredentialId.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const closeConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
  }, [])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])
  const { mutateAsync: deleteModelCredential } = useDeleteModelCredential(provider)
  const { mutateAsync: setModelCredentialDefault } = useSetModelCredentialDefault(provider)
  const handleSetDefault = useCallback(async (id: string) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await setModelCredentialDefault(id)
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [setModelCredentialDefault, onUpdate, notify, t, handleSetDoingAction])
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!pendingOperationCredentialId.current) {
      setDeleteCredentialId(null)
      return
    }
    try {
      handleSetDoingAction(true)
      await deleteModelCredential(pendingOperationCredentialId.current)
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      onUpdate?.()
      setDeleteCredentialId(null)
      pendingOperationCredentialId.current = null
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onUpdate, notify, t, handleSetDoingAction])
  const handleOpenSetup = useCallback((credential?: Credential) => {
    onSetup(credential)
    setMergedIsOpen(false)
  }, [onSetup, setMergedIsOpen])

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
          {
            renderTrigger
              ? renderTrigger(mergedIsOpen)
              : (
                <Button
                  className='grow'
                  size='small'
                >
                  <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
                  {t('common.operation.config')}
                </Button>
              )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[100]'>
          <div className={cn(
            'w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg',
            popupClassName,
          )}>
            <div className='max-h-[304px] overflow-y-auto py-1'>
              {
                !!credentials.length && (
                  <div className='p-1'>
                    <div className={cn(
                      'system-xs-medium px-3 pb-0.5 pt-1 text-text-tertiary',
                      showItemSelectedIcon && 'pl-7',
                    )}>
                      API Keys
                    </div>
                    {
                      credentials.map(credential => (
                        <Item
                          key={credential.credential_id}
                          credential={credential}
                          disabled={disabled}
                          onDelete={openConfirm}
                          onEdit={handleOpenSetup}
                          onSetDefault={handleSetDefault}
                          onItemClick={onItemClick}
                          showSelectedIcon={showItemSelectedIcon}
                          selectedCredentialId={selectedCredentialId}
                        />
                      ))
                    }
                  </div>
                )
              }
            </div>
            <div className='h-[1px] bg-divider-subtle'></div>
            <div className='p-2'>
              <Button
                onClick={() => handleOpenSetup()}
                className='w-full'
              >
                add api key
              </Button>
            </div>
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
      {
        deleteCredentialId && (
          <Confirm
            isShow
            title={t('datasetDocuments.list.delete.title')}
            isDisabled={doingAction}
            onCancel={closeConfirm}
            onConfirm={handleConfirm}
          />
        )
      }
    </>
  )
}

export default memo(Authorized)
