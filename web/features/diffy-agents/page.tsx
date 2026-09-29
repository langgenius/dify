'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import useDocumentTitle from '@/hooks/use-document-title'
import { createDiffyAgent, deleteDiffyAgent, fetchDiffyAgents } from './client'

const TOKEN_STORAGE_KEY = 'diffy_agents_admin_token'

function readStoredToken() {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  }
  catch {
    return ''
  }
}

function storeToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
  }
  catch {
    // sessionStorage unavailable (private mode, etc.) — token just won't persist across reloads.
  }
}

function clearStoredToken() {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  }
  catch {
    // ignore
  }
}

function UnauthorizedState() {
  return (
    <div className="flex h-0 min-w-0 grow flex-col items-center justify-center gap-2 bg-background-body">
      <h1 className="system-md-semibold text-text-primary">Diffy Agents</h1>
      <p className="system-sm-regular text-text-tertiary">
        Only the workspace owner can manage Diffy agent mappings.
      </p>
    </div>
  )
}

function PasswordGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const handleSubmit = async () => {
    if (!password || checking) return
    setChecking(true)
    setError('')

    try {
      await fetchDiffyAgents(password)
      storeToken(password)
      onUnlock(password)
    }
    catch {
      setError('Invalid backend admin password')
    }
    finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-0 min-w-0 grow flex-col items-center justify-center gap-4 bg-background-body">
      <div className="flex w-80 max-w-full flex-col gap-3 rounded-xl border-[0.5px] border-divider-regular bg-components-card-bg p-6 shadow-xs shadow-shadow-shadow-3">
        <h1 className="system-md-semibold text-text-primary">Diffy Agents</h1>
        <p className="system-xs-regular text-text-tertiary">
          Enter the chatkit-backend admin password to manage hostname → Diffy iframe mappings.
        </p>
        <Field name="backend-admin-password">
          <FieldLabel className="system-xs-medium text-text-secondary">Admin password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              type="password"
              autoComplete="off"
              value={password}
              onValueChange={setPassword}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSubmit()
              }}
            />
          </InputGroup>
        </Field>
        {error && <p className="system-xs-regular text-text-destructive">{error}</p>}
        <Button variant="primary" size="medium" loading={checking} onClick={() => void handleSubmit()}>
          Unlock
        </Button>
      </div>
    </div>
  )
}

function AddAgentForm({ token, onAdded }: { token: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [iframeUrl, setIframeUrl] = useState('')
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createDiffyAgent(token, { name, hostname, iframe_url: iframeUrl }),
    onSuccess: () => {
      toast.success('Agent added')
      setName('')
      setHostname('')
      setIframeUrl('')
      setError('')
      onAdded()
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const handleSubmit = () => {
    if (createMutation.isPending) return
    if (!name.trim() || !hostname.trim() || !iframeUrl.trim()) {
      setError('Name, hostname, and iframe URL are all required')
      return
    }
    setError('')
    createMutation.mutate()
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-[0.5px] border-divider-regular bg-components-card-bg p-5 shadow-xs shadow-shadow-shadow-3">
      <h2 className="system-sm-semibold text-text-primary">Add agent</h2>
      <div className="flex flex-wrap gap-3">
        <Field name="agent-name" className="min-w-50 flex-1">
          <FieldLabel className="system-xs-medium text-text-secondary">Name</FieldLabel>
          <InputGroup>
            <InputGroupInput
              type="text"
              placeholder="Support Bot"
              value={name}
              onValueChange={setName}
            />
          </InputGroup>
        </Field>
        <Field name="agent-hostname" className="min-w-50 flex-1">
          <FieldLabel className="system-xs-medium text-text-secondary">Hostname / URL</FieldLabel>
          <InputGroup>
            <InputGroupInput
              type="text"
              placeholder="chat.example.com or https://chat.example.com/support"
              value={hostname}
              onValueChange={setHostname}
            />
          </InputGroup>
        </Field>
      </div>
      <Field name="agent-iframe-url">
        <FieldLabel className="system-xs-medium text-text-secondary">Diffy iframe URL</FieldLabel>
        <InputGroup>
          <InputGroupInput
            type="text"
            placeholder="https://udify.app/chatbot/..."
            value={iframeUrl}
            onValueChange={setIframeUrl}
          />
        </InputGroup>
      </Field>
      {error && <p className="system-xs-regular text-text-destructive">{error}</p>}
      <div>
        <Button
          variant="primary"
          size="medium"
          loading={createMutation.isPending}
          onClick={handleSubmit}
        >
          Add agent
        </Button>
      </div>
    </div>
  )
}

function AgentsTable({ token }: { token: string }) {
  const queryClient = useQueryClient()
  const agentsQuery = useQuery({
    queryKey: ['diffy-agents', token],
    queryFn: () => fetchDiffyAgents(token),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDiffyAgent(token, id),
    onSuccess: () => {
      toast.success('Agent deleted')
      void queryClient.invalidateQueries({ queryKey: ['diffy-agents', token] })
    },
    onError: () => {
      toast.error('Failed to delete agent')
    },
  })

  if (agentsQuery.isPending) {
    return <p className="system-sm-regular text-text-tertiary">Loading agents…</p>
  }

  if (agentsQuery.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="system-sm-regular text-text-destructive">Failed to load agents.</p>
        <Button size="small" variant="secondary" onClick={() => void agentsQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const agents = agentsQuery.data ?? []

  if (agents.length === 0) {
    return <p className="system-sm-regular text-text-tertiary">No agents configured yet.</p>
  }

  return (
    <div className="overflow-hidden rounded-xl border-[0.5px] border-divider-regular bg-components-card-bg shadow-xs shadow-shadow-shadow-3">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-divider-regular text-left">
            <th className="px-4 py-2.5 system-xs-medium-uppercase text-text-tertiary">Name</th>
            <th className="px-4 py-2.5 system-xs-medium-uppercase text-text-tertiary">Hostname</th>
            <th className="px-4 py-2.5 system-xs-medium-uppercase text-text-tertiary">Iframe URL</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => (
            <tr key={agent.id} className="border-b border-divider-regular last:border-b-0">
              <td className="max-w-40 truncate px-4 py-2.5 system-sm-regular text-text-primary">
                {agent.name}
              </td>
              <td className="max-w-60 truncate px-4 py-2.5 system-sm-regular text-text-secondary">
                {agent.hostname}
              </td>
              <td className="max-w-80 truncate px-4 py-2.5 system-sm-regular text-text-secondary">
                {agent.iframe_url}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button
                  size="small"
                  variant="secondary"
                  loading={deleteMutation.isPending && deleteMutation.variables === agent.id}
                  onClick={() => {
                    if (confirm(`Delete "${agent.name}"?`)) deleteMutation.mutate(agent.id)
                  }}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffyAgentsManager({ token }: { token: string }) {
  const queryClient = useQueryClient()

  return (
    <div className="flex h-0 min-w-0 grow flex-col gap-5 overflow-y-auto bg-background-body p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">Diffy Agents</h1>
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            clearStoredToken()
            window.location.reload()
          }}
        >
          Lock
        </Button>
      </div>
      <p className="system-sm-regular text-text-tertiary">
        Maps a website's hostname to the Diffy iframe embed URL your chat widget shows on that
        site. Backed by a separate chatkit-backend service, not Dify's own database.
      </p>
      <AddAgentForm
        token={token}
        onAdded={() => void queryClient.invalidateQueries({ queryKey: ['diffy-agents', token] })}
      />
      <AgentsTable token={token} />
    </div>
  )
}

export default function DiffyAgentsPage() {
  useDocumentTitle('Diffy Agents')
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const [token, setToken] = useState(readStoredToken)

  if (!isCurrentWorkspaceOwner) return <UnauthorizedState />

  if (!token) return <PasswordGate onUnlock={setToken} />

  return <DiffyAgentsManager token={token} />
}
