'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCheckLine, RiDeleteBin7Line, RiSettings3Line } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { toast } from '@/app/components/base/ui/toast'
import {
  activateSandboxProvider,
  deleteSandboxProviderConfig,
  listSandboxProviders,
  saveSandboxProviderConfig,
} from '@/service/sandbox'
import type { SandboxProvider } from '@/service/sandbox'

const providerConfigs: Record<string, { label: string, description: string, fields: Array<{ key: string, label: string, secret?: boolean }> }> = {
  docker: {
    label: 'Docker',
    description: 'Run agent tools in Docker containers on the local machine.',
    fields: [
      { key: 'docker_sock', label: 'Docker Socket Path' },
      { key: 'docker_image', label: 'Docker Image' },
    ],
  },
  e2b: {
    label: 'E2B Cloud',
    description: 'Run agent tools in E2B cloud sandboxes.',
    fields: [
      { key: 'api_key', label: 'E2B API Key', secret: true },
      { key: 'e2b_default_template', label: 'Template' },
    ],
  },
  ssh: {
    label: 'SSH Remote',
    description: 'Run agent tools on a remote server via SSH.',
    fields: [
      { key: 'ssh_host', label: 'Host' },
      { key: 'ssh_port', label: 'Port' },
      { key: 'ssh_username', label: 'Username' },
      { key: 'ssh_password', label: 'Password / Private Key', secret: true },
    ],
  },
  aws_code_interpreter: {
    label: 'AWS CodeInterpreter',
    description: 'Run agent tools in Amazon Bedrock AgentCore Code Interpreter.',
    fields: [
      { key: 'aws_access_key_id', label: 'Access Key ID', secret: true },
      { key: 'aws_secret_access_key', label: 'Secret Access Key', secret: true },
      { key: 'aws_region', label: 'Region' },
      { key: 'code_interpreter_id', label: 'Code Interpreter ID' },
    ],
  },
}

export default function SandboxProviderPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<SandboxProvider[]>([])
  const [editingType, setEditingType] = useState<string | null>(null)
  const [editConfig, setEditConfig] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const fetchProviders = useCallback(async () => {
    try {
      const data = await listSandboxProviders()
      setProviders(Array.isArray(data) ? data : [])
    }
    catch {
      setProviders([])
    }
  }, [])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleSave = async (providerType: string) => {
    setLoading(true)
    try {
      await saveSandboxProviderConfig(providerType, editConfig, true)
      toast.success('Saved and activated')
      setEditingType(null)
      fetchProviders()
    }
    catch (e: any) {
      toast.error(e.message || 'Failed to save')
    }
    finally { setLoading(false) }
  }

  const handleDelete = async (providerType: string) => {
    try {
      await deleteSandboxProviderConfig(providerType)
      toast.success('Deleted')
      fetchProviders()
    }
    catch (e: any) {
      toast.error(e.message || 'Failed to delete')
    }
  }

  const handleActivate = async (providerType: string) => {
    try {
      await activateSandboxProvider(providerType)
      toast.success('Activated')
      fetchProviders()
    }
    catch (e: any) {
      toast.error(e.message || 'Failed to activate')
    }
  }

  const activeProvider = providers.find(p => p.is_active)

  return (
    <div className="pt-2 pb-7">
      <div className="mb-4 flex items-center gap-2">
        <RiSettings3Line className="h-5 w-5 text-text-secondary" />
        <h2 className="text-text-primary title-xl-semi-bold">Sandbox Providers</h2>
      </div>
      <p className="mb-6 text-text-tertiary system-sm-regular">
        Configure where agent tools execute in isolated environments.
        {activeProvider && (
          <span className="ml-2 text-text-accent">
            Active: <strong>{providerConfigs[activeProvider.provider_type]?.label || activeProvider.provider_type}</strong>
          </span>
        )}
      </p>

      <div className="grid gap-4">
        {Object.entries(providerConfigs).map(([type, cfg]) => {
          const existing = providers.find(p => p.provider_type === type)
          const isActive = existing?.is_active
          const isEditing = editingType === type

          return (
            <div key={type} className={`rounded-xl border ${isActive ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg' : 'border-divider-subtle'} p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-text-primary system-md-semibold">{cfg.label}</h3>
                  <p className="text-text-tertiary system-xs-regular mt-0.5">{cfg.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="flex items-center gap-1 rounded-full bg-util-colors-green-green-50 px-2 py-0.5 text-[11px] text-util-colors-green-green-600">
                      <RiCheckLine className="h-3 w-3" /> Active
                    </span>
                  )}
                  {existing && !isActive && (
                    <Button size="small" onClick={() => handleActivate(type)}>Activate</Button>
                  )}
                  <Button size="small" variant="secondary" onClick={() => {
                    setEditingType(isEditing ? null : type)
                    setEditConfig(existing?.config || {})
                  }}>
                    {isEditing ? 'Cancel' : 'Configure'}
                  </Button>
                  {existing && (
                    <Button size="small" variant="ghost" onClick={() => handleDelete(type)}>
                      <RiDeleteBin7Line className="h-4 w-4 text-text-tertiary" />
                    </Button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="mt-4 space-y-3 border-t border-divider-subtle pt-4">
                  {cfg.fields.map(field => (
                    <div key={field.key}>
                      <label className="mb-1 block text-text-secondary system-xs-semibold">{field.label}</label>
                      <Input
                        type={field.secret ? 'password' : 'text'}
                        value={editConfig[field.key] || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.label}
                      />
                    </div>
                  ))}
                  <Button
                    variant="primary"
                    disabled={loading}
                    onClick={() => handleSave(type)}
                  >
                    {loading ? 'Saving...' : 'Save & Activate'}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
