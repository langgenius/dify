import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCheckLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
} from '@remixicon/react'
import Indicator from '@/app/components/header/indicator'
import Badge from '@/app/components/base/badge'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import cn from '@/utils/classnames'
import type { Credential } from '../types'
import { CredentialTypeEnum } from '../types'

type ItemProps = {
  credential: Credential
  disabled?: boolean
  onDelete?: (id: string) => void
  onEdit?: (id: string, values: Record<string, any>) => void
  onSetDefault?: (id: string) => void
  onRename?: (payload: {
    credential_id: string
    name: string
  }) => void
  disableRename?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
  disableSetDefault?: boolean
  onItemClick?: (id: string) => void
  showSelectedIcon?: boolean
  selectedCredentialId?: string
}
const Item = ({
  credential,
  disabled,
  onDelete,
  onEdit,
  onSetDefault,
  onRename,
  disableRename,
  disableEdit,
  disableDelete,
  disableSetDefault,
  onItemClick,
  showSelectedIcon,
  selectedCredentialId,
}: ItemProps) => {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(credential.name)
  const isOAuth = credential.credential_type === CredentialTypeEnum.OAUTH2
  const showAction = useMemo(() => {
    return !(disableRename && disableEdit && disableDelete && disableSetDefault)
  }, [disableRename, disableEdit, disableDelete, disableSetDefault])

  return (
    <div
      key={credential.id}
      className={cn(
        'group flex h-8 items-center rounded-lg p-1 hover:bg-state-base-hover',
        renaming && 'bg-state-base-hover',
      )}
      onClick={() => onItemClick?.(credential.id === '__workspace_default__' ? '' : credential.id)}
    >
      {
        renaming && (
          <div className='flex w-full items-center space-x-1'>
            <Input
              wrapperClassName='grow rounded-[6px]'
              className='h-6'
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('common.placeholder.input')}
              onClick={e => e.stopPropagation()}
            />
            <Button
              size='small'
              variant='primary'
              onClick={(e) => {
                e.stopPropagation()
                onRename?.({
                  credential_id: credential.id,
                  name: renameValue,
                })
                setRenaming(false)
              }}
            >
              {t('common.operation.save')}
            </Button>
            <Button
              size='small'
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(false)
              }}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
        )
      }
      {
        !renaming && (
          <div className='flex w-0 grow items-center space-x-1.5'>
            {
              showSelectedIcon && (
                <div className='h-4 w-4'>
                  {
                    selectedCredentialId === credential.id && (
                      <RiCheckLine className='h-4 w-4 text-text-accent' />
                    )
                  }
                </div>
              )
            }
            <Indicator className='ml-2 mr-1.5 shrink-0' />
            <div
              className='system-md-regular truncate text-text-secondary'
              title={credential.name}
            >
              {credential.name}
            </div>
            {
              credential.is_default && (
                <Badge className='shrink-0'>
                  {t('plugin.auth.default')}
                </Badge>
              )
            }
          </div>
        )
      }
      {
        showAction && !renaming && (
          <div className='ml-2 hidden shrink-0 items-center group-hover:flex'>
            {
              !credential.is_default && !disableSetDefault && (
                <Button
                  size='small'
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetDefault?.(credential.id)
                  }}
                >
                  {t('plugin.auth.setDefault')}
                </Button>
              )
            }
            {
              !disableRename && (
                <Tooltip popupContent={t('common.operation.rename')}>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenaming(true)
                      setRenameValue(credential.name)
                    }}
                  >
                    <RiEditLine className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !isOAuth && !disableEdit && (
                <Tooltip popupContent={t('common.operation.edit')}>
                  <ActionButton
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit?.(
                        credential.id,
                        {
                          ...credential.credentials,
                          __name__: credential.name,
                          __credential_id__: credential.id,
                        },
                      )
                    }}
                  >
                    <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
                  </ActionButton>
                </Tooltip>
              )
            }
            {
              !disableDelete && (
                <Tooltip popupContent={t('common.operation.delete')}>
                  <ActionButton
                    className='hover:bg-transparent'
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete?.(credential.id)
                    }}
                  >
                    <RiDeleteBinLine className='h-4 w-4 text-text-tertiary hover:text-text-destructive' />
                  </ActionButton>
                </Tooltip>
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default memo(Item)
