import {
  memo,
  useCallback,
} from 'react'
import { RiAddLine } from '@remixicon/react'
import CredentialItem from './credential-item'
import type {
  Credential,
  CustomModel,
} from '../../declarations'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'

type AuthorizedItemProps = {
  model?: CustomModel
  disabled?: boolean
  onDelete?: (id: string) => void
  onEdit?: (model?: CustomModel, credential?: Credential) => void
  onSetDefault?: (id: string) => void
  onItemClick?: (id: string) => void
  showItemSelectedIcon?: boolean
  selectedCredentialId?: string
  disableSetDefault?: boolean
  credentials: Credential[]
}
export const AuthorizedItem = ({
  model,
  credentials,
  disabled,
  onDelete,
  onEdit,
  onSetDefault,
  onItemClick,
  showItemSelectedIcon,
  selectedCredentialId,
  disableSetDefault,
}: AuthorizedItemProps) => {
  const handleEdit = useCallback((credential?: Credential) => {
    onEdit?.(model, credential)
  }, [onEdit, model])
  return (
    <div className='p-1'>
      {
        model && (
          <div
            className='flex h-9 items-center'
          >
            <div className='h-5 w-5 shrink-0'></div>
            <div
              className='system-md-medium mx-1 truncate text-text-primary'
              title={model.model}
            >
              {model.model}
            </div>
            <Tooltip
              asChild
              popupContent='Add model credential'
            >
              <Button
                className='h-6 w-6 rounded-full p-0'
                size='small'
                variant='secondary-accent'
              >
                <RiAddLine className='h-4 w-4' />
              </Button>
            </Tooltip>
          </div>
        )
      }
      {
        credentials.map(credential => (
          <CredentialItem
            key={credential.credential_id}
            credential={credential}
            disabled={disabled}
            onDelete={onDelete}
            onEdit={handleEdit}
            onSetDefault={onSetDefault}
            onItemClick={onItemClick}
            showSelectedIcon={showItemSelectedIcon}
            selectedCredentialId={selectedCredentialId}
            disableSetDefault={disableSetDefault}
          />
        ))
      }
    </div>
  )
}

export default memo(AuthorizedItem)
