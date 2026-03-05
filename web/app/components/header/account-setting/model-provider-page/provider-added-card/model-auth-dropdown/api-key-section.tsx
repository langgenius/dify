import type { Credential, CustomModel, ModelProvider } from '../../declarations'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CredentialItem from '../../model-auth/authorized/credential-item'

type ApiKeySectionProps = {
  provider: ModelProvider
  credentials: Credential[]
  selectedCredentialId: string | undefined
  isActivating?: boolean
  onItemClick: (credential: Credential, model?: CustomModel) => void
  onEdit: (credential?: Credential) => void
  onDelete: (credential?: Credential) => void
  onAdd: () => void
}

function ApiKeySection({
  provider,
  credentials,
  selectedCredentialId,
  isActivating,
  onItemClick,
  onEdit,
  onDelete,
  onAdd,
}: ApiKeySectionProps) {
  const { t } = useTranslation()
  const notAllowCustomCredential = provider.allow_custom_token === false

  if (!credentials.length) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <div className="rounded-[10px] bg-gradient-to-r from-state-base-hover to-transparent p-4">
          <div className="flex flex-col gap-1">
            <div className="text-text-secondary system-sm-medium">
              {t('modelProvider.card.noApiKeysTitle', { ns: 'common' })}
            </div>
            <div className="text-text-tertiary system-xs-regular">
              {t('modelProvider.card.noApiKeysDescription', { ns: 'common' })}
            </div>
          </div>
        </div>
        {!notAllowCustomCredential && (
          <Button
            onClick={onAdd}
            className="w-full"
          >
            {t('modelProvider.auth.addApiKey', { ns: 'common' })}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="border-t border-t-divider-subtle">
      <div className="px-1">
        <div className="pb-1 pl-7 pr-2 pt-3 text-text-tertiary system-xs-medium-uppercase">
          {t('modelProvider.auth.apiKeys', { ns: 'common' })}
        </div>
        <div className="max-h-[200px] overflow-y-auto">
          {credentials.map(credential => (
            <CredentialItem
              key={credential.credential_id}
              credential={credential}
              disabled={isActivating}
              showSelectedIcon
              selectedCredentialId={selectedCredentialId}
              onItemClick={onItemClick}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
      {!notAllowCustomCredential && (
        <div className="p-2">
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
