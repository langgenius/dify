import {
  memo,
  useCallback,
} from 'react'
import { RiAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import CredentialItem from './credential-item'
import type {
  Credential,
  CustomModel,
  CustomModelCredential,
} from '../../declarations'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'

type AuthorizedItemProps = {
  model?: CustomModelCredential
  title?: string
  disabled?: boolean
  onDelete?: (credential?: Credential, model?: CustomModel) => void
  onEdit?: (credential?: Credential, model?: CustomModel) => void
  showItemSelectedIcon?: boolean
  selectedCredentialId?: string
  credentials: Credential[]
  onItemClick?: (credential: Credential, model?: CustomModel) => void
  enableAddModelCredential?: boolean
  notAllowCustomCredential?: boolean
}
export const AuthorizedItem = ({
  model,
  title,
  credentials,
  disabled,
  onDelete,
  onEdit,
  showItemSelectedIcon,
  selectedCredentialId,
  onItemClick,
  enableAddModelCredential,
  notAllowCustomCredential,
}: AuthorizedItemProps) => {
  const { t } = useTranslation()
  const handleEdit = useCallback((credential?: Credential) => {
    onEdit?.(credential, model)
  }, [onEdit, model])
  const handleDelete = useCallback((credential?: Credential) => {
    onDelete?.(credential, model)
  }, [onDelete, model])
  const handleItemClick = useCallback((credential: Credential) => {
    onItemClick?.(credential, model)
  }, [onItemClick, model])

  return (
    <div className='p-1'>
      <div
        className='flex h-9 items-center'
      >
        <div className='h-5 w-5 shrink-0'></div>
        <div
          className='system-md-medium mx-1 grow truncate text-text-primary'
          title={title ?? model?.model}
        >
          {title ?? model?.model}
        </div>
        {
          enableAddModelCredential && !notAllowCustomCredential && (
            <Tooltip
              asChild
              popupContent={t('common.modelProvider.auth.addModelCredential')}
            >
              <Button
                className='h-6 w-6 shrink-0 rounded-full p-0'
                size='small'
                variant='secondary-accent'
                onClick={() => handleEdit?.()}
              >
                <RiAddLine className='h-4 w-4' />
              </Button>
            </Tooltip>
          )
        }
      </div>
      {
        credentials.map(credential => (
          <CredentialItem
            key={credential.credential_id}
            credential={credential}
            disabled={disabled}
            onDelete={handleDelete}
            onEdit={handleEdit}
            showSelectedIcon={showItemSelectedIcon}
            selectedCredentialId={selectedCredentialId}
            onItemClick={handleItemClick}
          />
        ))
      }
    </div>
  )
}

export default memo(AuthorizedItem)
