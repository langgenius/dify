import {
  memo,
  useCallback,
} from 'react'
import CredentialItem from './credential-item'
import type {
  Credential,
  CustomModel,
  CustomModelCredential,
  ModelProvider,
} from '../../declarations'
import ModelIcon from '../../model-icon'

type AuthorizedItemProps = {
  provider: ModelProvider
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
  showModelTitle?: boolean
  disableDeleteButShowAction?: boolean
  disableDeleteTip?: string
}
export const AuthorizedItem = ({
  provider,
  model,
  title,
  credentials,
  disabled,
  onDelete,
  onEdit,
  showItemSelectedIcon,
  selectedCredentialId,
  onItemClick,
  showModelTitle,
  disableDeleteButShowAction,
  disableDeleteTip,
}: AuthorizedItemProps) => {
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
      {
        showModelTitle && (
          <div
            className='flex h-9 items-center px-2'
          >
            {
              model?.model && (
                <ModelIcon
                  className='mr-1 h-5 w-5 shrink-0'
                  provider={provider}
                  modelName={model.model}
                />
              )
            }
            <div
              className='system-md-medium mx-1 grow truncate text-text-primary'
              title={title ?? model?.model}
            >
              {title ?? model?.model}
            </div>
          </div>
        )
      }
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
            disableDeleteButShowAction={disableDeleteButShowAction}
            disableDeleteTip={disableDeleteTip}
          />
        ))
      }
    </div>
  )
}

export default memo(AuthorizedItem)
