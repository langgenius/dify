'use client'

import type { ApiKeyModalDataSource } from '@/app/components/plugins/plugin-auth/authorize/api-key-modal'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import ConnectionSelector from '@/app/components/plugins/plugin-auth/connections/connection-selector'
import SaveConnectionModal from '@/app/components/plugins/plugin-auth/connections/save-connection-modal'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { PermissionLevel } from '@/models/permission'

const initialConnections: Credential[] = [
  {
    id: 'demo-existing-gmail',
    name: 'Existing Gmail',
    provider: 'gmail',
    credential_type: CredentialTypeEnum.OAUTH2,
    visibility: PermissionLevel.allTeamMembers,
    is_default: false,
  },
]

export default function WorkspaceOAuthDemo() {
  const { t } = useTranslation(['plugin'])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)
  const [failNextSave, setFailNextSave] = useState(false)
  const [connections, setConnections] = useState(initialConnections)
  const [selectedId, setSelectedId] = useState(initialConnections[0]?.id)
  const apiKey: ApiKeyModalDataSource = {
    schemas: [
      { name: 'api_key', label: 'API Key', type: FormTypeEnum.secretInput, required: true },
    ],
    defaultName: 'Demo API Key',
    permissionProfile: { name: 'Demo user', avatar_url: '' },
    save: async ({ name, credentials, visibility }) => {
      if (failNextSave) {
        setFailNextSave(false)
        throw new Error('Demo save failed')
      }
      const credentialId = `demo-api-key-${crypto.randomUUID()}`
      const enteredKey = credentials.api_key
      setConnections((current) => [
        ...current,
        {
          id: credentialId,
          name: name.trim() || 'Demo API Key',
          provider: 'gmail',
          credential_type: CredentialTypeEnum.API_KEY,
          visibility,
          is_default: false,
          credentials: {
            api_key: typeof enteredKey === 'string' ? `•••• ${enteredKey.slice(-4)}` : 'API Key',
          },
        },
      ])
      return { credentialId }
    },
  }

  return (
    <section
      aria-labelledby="workspace-oauth-demo"
      className="space-y-4 rounded-xl border border-divider-regular bg-components-panel-bg p-4"
    >
      <h2 id="workspace-oauth-demo" className="system-md-semibold text-text-primary">
        Workspace OAuth
      </h2>
      <p className="system-sm-regular text-text-secondary">
        Frontend demo: authorization has completed for demo@gmail.com. No OAuth request is made.
      </p>
      <Field>
        <FieldLabel className="flex items-center gap-2">
          <Checkbox checked={failNextSave} onCheckedChange={setFailNextSave} />
          Fail the next save
        </FieldLabel>
      </Field>
      <ConnectionSelector
        dataSource={{
          credentials: connections,
          selectedCredential: connections.find((connection) => connection.id === selectedId),
          fallbackName: 'No connection',
          canUse: true,
          canCreate: true,
          // The separate button below represents a completed OAuth session.
          canOAuth: false,
          canApiKey: true,
          allowCustom: true,
          subtitle: (connection) =>
            connection?.credential_type === CredentialTypeEnum.API_KEY
              ? String(connection.credentials?.api_key ?? 'API Key')
              : 'demo@gmail.com',
          select: (connection) => setSelectedId(connection.id),
          onCreated: setSelectedId,
          addOAuth: () => {},
          openOAuthClientSettings: () => {},
          apiKey,
          connectionActions: {
            canManageConnection: () => false,
            canEditConnection: () => false,
            remove: async () => {},
            edit: { canEdit: false, canUse: true, save: async () => {} },
            apiKey,
          },
        }}
      />
      <Button
        ref={triggerRef}
        onClick={() => {
          setSession((current) => current + 1)
          setOpen(true)
        }}
      >
        {t(($) => $['auth.connection.saveWithProvider'], { provider: 'Gmail' })}
      </Button>
      {session > 0 && (
        <SaveConnectionModal
          key={session}
          open={open}
          onOpenChange={setOpen}
          onCreated={setSelectedId}
          providerName="Gmail"
          accountName="demo@gmail.com"
          defaultName="Workspace Gmail"
          finalFocus={triggerRef}
          dataSource={{
            save: async ({ name, visibility, setDefault }) => {
              if (failNextSave) {
                setFailNextSave(false)
                throw new Error('Demo save failed')
              }
              const credentialId = `demo-oauth-${crypto.randomUUID()}`
              setConnections((current) => [
                ...current.map((connection) =>
                  setDefault ? { ...connection, is_default: false } : connection,
                ),
                {
                  id: credentialId,
                  name,
                  provider: 'gmail',
                  credential_type: CredentialTypeEnum.OAUTH2,
                  visibility,
                  is_default: setDefault,
                },
              ])
              return { credentialId }
            },
          }}
        />
      )}
    </section>
  )
}
