'use client'

import type { ReactNode } from 'react'
import type { DiffyAgent } from './client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import useDocumentTitle from '@/hooks/use-document-title'
import {
  createDiffyAgent,
  deleteDiffyAgent,
  fetchDiffyAgents,
  isUnauthorizedError,
} from './client'
import { EmbedGuide } from './embed-guide'

// Only used when signing in with the Dify account is not possible (for example
// the backend has no DIFY_INTERNAL_API_URL): an optional admin password.
const TOKEN_STORAGE_KEY = 'diffy_agents_admin_token'

function readStoredToken() {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // sessionStorage unavailable (private mode, etc.): the password just won't persist.
  }
}

function clearStoredToken() {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function CenteredMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-0 min-w-0 grow flex-col items-center justify-center gap-2 bg-background-body">
      <h1 className="system-md-semibold text-text-primary">{title}</h1>
      {children}
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
    } catch (err) {
      setError(
        isUnauthorizedError(err) ? 'Invalid backend admin password' : 'Could not reach the backend',
      )
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-0 min-w-0 grow flex-col items-center justify-center gap-4 bg-background-body">
      <div className="flex w-80 max-w-full flex-col gap-3 rounded-xl border-[0.5px] border-divider-regular bg-components-card-bg p-6 shadow-xs shadow-shadow-shadow-3">
        <h1 className="system-md-semibold text-text-primary">Diffy Agents</h1>
        <p className="system-xs-regular text-text-tertiary">
          Signing in with your Dify account did not work here, so the backend needs its admin
          password instead.
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
        <Button
          variant="primary"
          size="medium"
          loading={checking}
          onClick={() => void handleSubmit()}
        >
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
              placeholder="https://chat.example.com or https://chat.example.com/support"
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
            placeholder="https://your-dify-domain/chatbot/..."
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

function AgentsTable({
  agents,
  token,
  onChanged,
}: {
  agents: DiffyAgent[]
  token: string
  onChanged: () => void
}) {
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDiffyAgent(token, id),
    onSuccess: () => {
      toast.success('Agent deleted')
      onChanged()
    },
    onError: () => {
      toast.error('Failed to delete agent')
    },
  })

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
            <th className="px-4 py-2.5 system-xs-medium-uppercase text-text-tertiary">
              Iframe URL
            </th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
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
                    if (confirm(`Delete ${agent.name}?`)) deleteMutation.mutate(agent.id)
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

function DiffyAgentsManager({
  token,
  agents,
  onChanged,
}: {
  token: string
  agents: DiffyAgent[]
  onChanged: () => void
}) {
  return (
    <div className="flex h-0 min-w-0 grow flex-col gap-5 overflow-y-auto bg-background-body p-8 *:shrink-0">
      <div className="flex items-center justify-between">
        <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">Diffy Agents</h1>
        {token && (
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
        )}
      </div>
      <p className="system-sm-regular text-text-tertiary">
        Maps the address of a website to the Diffy chat shown on it. The list is kept by the
        diffy-backend service, not in Dify.
      </p>
      <EmbedGuide agents={agents} />
      <AddAgentForm token={token} onAdded={onChanged} />
      <AgentsTable agents={agents} token={token} onChanged={onChanged} />
    </div>
  )
}

// Signs in with the Dify console session first (no password). Only if the
// backend rejects that does it fall back to asking for the admin password.
function DiffyAgentsAccess() {
  const queryClient = useQueryClient()
  const [token, setToken] = useState(readStoredToken)
  const agentsQuery = useQuery({
    queryKey: ['diffy-agents', token],
    queryFn: () => fetchDiffyAgents(token),
    retry: false,
  })

  if (agentsQuery.isPending) {
    return (
      <CenteredMessage title="Diffy Agents">
        <p className="system-sm-regular text-text-tertiary">Loading agents…</p>
      </CenteredMessage>
    )
  }

  if (agentsQuery.isError) {
    if (isUnauthorizedError(agentsQuery.error)) return <PasswordGate onUnlock={setToken} />

    return (
      <CenteredMessage title="Diffy Agents">
        <p className="system-sm-regular text-text-destructive">
          Could not reach the Diffy backend.
        </p>
        <Button size="small" variant="secondary" onClick={() => void agentsQuery.refetch()}>
          Retry
        </Button>
      </CenteredMessage>
    )
  }

  return (
    <DiffyAgentsManager
      token={token}
      agents={agentsQuery.data}
      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['diffy-agents', token] })}
    />
  )
}

export default function DiffyAgentsPage() {
  useDocumentTitle('Diffy Agents')
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)

  if (!isCurrentWorkspaceOwner) {
    return (
      <CenteredMessage title="Diffy Agents">
        <p className="system-sm-regular text-text-tertiary">
          Only the workspace owner can manage Diffy agent mappings.
        </p>
      </CenteredMessage>
    )
  }

  return <DiffyAgentsAccess />
}
