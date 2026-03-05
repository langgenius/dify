import type { Credential, CustomModel, ModelProvider } from '../../declarations'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CredentialItem from '../../model-auth/authorized/credential-item'

type ApiKeySectionProps = {
  provider: ModelProvider
  credentials: Credential[]
  selectedCredentialId: string | undefined
  onItemClick: (credential: Credential, model?: CustomModel) => void
  onEdit: (credential?: Credential) => void
  onDelete: (credential?: Credential) => void
  onAdd: () => void
}

function ApiKeySection({
  provider,
  credentials,
  selectedCredentialId,
  onItemClick,
  onEdit,
  onDelete,
  onAdd,
}: ApiKeySectionProps) {
  const { t } = useTranslation()
  const notAllowCustomCredential = provider.allow_custom_token === false

  const handleItemClick = useCallback((credential: Credential) => {
    onItemClick(credential)
  }, [onItemClick])

  if (!credentials.length) {
    return (
      <div className="p-2">
        <div className="rounded-[10px] bg-gradient-to-b from-state-base-hover to-transparent p-3">
          <div className="text-text-secondary system-xs-medium">
            {t('modelProvider.card.noApiKeysTitle', { ns: 'common' })}
          </div>
          <div className="mt-0.5 text-text-tertiary system-2xs-regular">
            {t('modelProvider.card.noApiKeysDescription', { ns: 'common' })}
          </div>
        </div>
        {!notAllowCustomCredential && (
          <Button
            onClick={onAdd}
            className="mt-1 w-full"
          >
            {t('modelProvider.auth.addApiKey', { ns: 'common' })}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="px-3 pb-0.5 pt-2 text-text-tertiary system-2xs-medium-uppercase">
        {t('modelProvider.auth.apiKeys', { ns: 'common' })}
      </div>
      <div className="max-h-[200px] overflow-y-auto px-1">
        {credentials.map(credential => (
          <CredentialItem
            key={credential.credential_id}
            credential={credential}
            showSelectedIcon
            selectedCredentialId={selectedCredentialId}
            onItemClick={handleItemClick}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
      {!notAllowCustomCredential && (
        <div className="border-t border-t-divider-subtle p-2">
          <Button
            onClick={onAdd}
            className="w-full"
          >
            {t('modelProvider.auth.addApiKey', { ns: 'common' })}
          </Button>
        </div>
      )}
    </div>
  )
}

export default memo(ApiKeySection)
