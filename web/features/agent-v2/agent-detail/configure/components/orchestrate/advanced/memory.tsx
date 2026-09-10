'use client'

import type {
  AgentExternalMemoryConfig,
  AgentSoulDifyToolConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { useAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toDifyToolConfigs } from '@/features/agent-v2/agent-composer/conversions'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

function toolKey(tool: AgentSoulDifyToolConfig) {
  return JSON.stringify([
    tool.plugin_id,
    tool.provider_id,
    tool.provider,
    tool.tool_name,
    tool.credential_ref?.id,
  ])
}

function MemoryToolSelect({
  label,
  tools,
  value,
  onChange,
  disabled,
}: {
  label: string
  tools: AgentSoulDifyToolConfig[]
  value?: AgentSoulDifyToolConfig
  onChange: (value: AgentSoulDifyToolConfig) => void
  disabled: boolean
}) {
  const items = tools.map((tool) => ({
    value: toolKey(tool),
    label: `${tool.provider ?? tool.provider_id} / ${tool.tool_name}`,
  }))
  return (
    <div className="flex flex-col gap-1">
      <span className="system-sm-medium text-text-secondary">{label}</span>
      <Select
        items={items}
        value={value ? toolKey(value) : null}
        disabled={disabled}
        onValueChange={(key) => {
          const tool = tools.find((item) => toolKey(item) === key)
          if (tool) onChange(tool)
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <SelectItemText>{item.label}</SelectItemText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function MemoryForm({
  initial,
  tools,
  onSave,
  readOnly,
}: {
  initial?: AgentExternalMemoryConfig | null
  tools: AgentSoulDifyToolConfig[]
  onSave: (value: AgentExternalMemoryConfig) => void
  readOnly: boolean
}) {
  const { t } = useTranslation('agentV2')
  const { t: common } = useTranslation('common')
  const [value, setValue] = useState<Partial<AgentExternalMemoryConfig>>(
    initial ?? {
      subject_kind: 'user',
      max_bytes: 8000,
      capture_max_bytes: 8192,
      capture: true,
    },
  )
  const options = Array.from(
    new Map(
      [
        ...tools,
        ...[value.prepare, value.observe].filter((tool): tool is AgentSoulDifyToolConfig => !!tool),
      ].map((tool) => [toolKey(tool), tool]),
    ).values(),
  )
  const valid =
    !!value.prepare &&
    !!value.observe &&
    (value.subject_kind !== 'business' || !!value.subject_id?.trim())
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!readOnly && valid && value.prepare && value.observe)
          onSave({ ...value, prepare: value.prepare, observe: value.observe })
      }}
    >
      <DialogTitle>{t(($) => $['agentDetail.configure.memory.label'])}</DialogTitle>
      <DialogDescription>
        {t(($) => $['agentDetail.configure.memory.description'])}
      </DialogDescription>
      <MemoryToolSelect
        label={t(($) => $['agentDetail.configure.memory.prepare'])}
        tools={options}
        value={value.prepare}
        onChange={(prepare) => setValue((current) => ({ ...current, prepare }))}
        disabled={readOnly}
      />
      <MemoryToolSelect
        label={t(($) => $['agentDetail.configure.memory.observe'])}
        tools={options}
        value={value.observe}
        onChange={(observe) => setValue((current) => ({ ...current, observe }))}
        disabled={readOnly}
      />
      <div className="flex flex-col gap-1">
        <span className="system-sm-medium text-text-secondary">
          {t(($) => $['agentDetail.configure.memory.subjectKind'])}
        </span>
        <Select
          value={value.subject_kind ?? 'user'}
          disabled={readOnly}
          items={[
            { value: 'user', label: t(($) => $['agentDetail.configure.memory.user']) },
            { value: 'business', label: t(($) => $['agentDetail.configure.memory.business']) },
          ]}
          onValueChange={(subject_kind) => {
            if (subject_kind)
              setValue((current) => ({ ...current, subject_kind, subject_id: undefined }))
          }}
        >
          <SelectTrigger aria-label={t(($) => $['agentDetail.configure.memory.subjectKind'])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">
              <SelectItemText>{t(($) => $['agentDetail.configure.memory.user'])}</SelectItemText>
            </SelectItem>
            <SelectItem value="business">
              <SelectItemText>
                {t(($) => $['agentDetail.configure.memory.business'])}
              </SelectItemText>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {value.subject_kind === 'business' && (
        <label className="flex flex-col gap-1 system-sm-medium text-text-secondary">
          {t(($) => $['agentDetail.configure.memory.subjectId'])}
          <Input
            required
            maxLength={256}
            disabled={readOnly}
            value={value.subject_id ?? ''}
            onChange={(event) =>
              setValue((current) => ({ ...current, subject_id: event.target.value }))
            }
          />
        </label>
      )}
      <label className="flex flex-col gap-1 system-sm-medium text-text-secondary">
        {t(($) => $['agentDetail.configure.memory.maxBytes'])}
        <Input
          type="number"
          required
          min={512}
          max={32768}
          disabled={readOnly}
          value={value.max_bytes ?? 8000}
          onChange={(event) =>
            setValue((current) => ({ ...current, max_bytes: Number(event.target.value) }))
          }
        />
      </label>
      <label className="flex items-center justify-between gap-2 system-sm-medium text-text-secondary">
        {t(($) => $['agentDetail.configure.memory.capture'])}
        <Switch
          checked={value.capture ?? true}
          disabled={readOnly}
          onCheckedChange={(capture) => setValue((current) => ({ ...current, capture }))}
        />
      </label>
      {value.capture !== false && (
        <label className="flex flex-col gap-1 system-sm-medium text-text-secondary">
          {t(($) => $['agentDetail.configure.memory.captureBytes'])}
          <Input
            type="number"
            required
            min={512}
            max={32768}
            disabled={readOnly}
            value={value.capture_max_bytes ?? 8192}
            onChange={(event) =>
              setValue((current) => ({ ...current, capture_max_bytes: Number(event.target.value) }))
            }
          />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <DialogClose render={<Button />}>{common(($) => $['operation.cancel'])}</DialogClose>
        {!readOnly && (
          <Button type="submit" variant="primary" disabled={!valid}>
            {common(($) => $['operation.save'])}
          </Button>
        )}
      </div>
    </form>
  )
}

export function AgentExternalMemorySettings() {
  const { t } = useTranslation('agentV2')
  const { t: common } = useTranslation('common')
  const [draft, setDraft] = useAtom(agentComposerDraftAtom)
  const readOnly = useAgentOrchestrateReadOnly()
  const [open, setOpen] = useState(false)
  const external = draft.memory?.external
  const tools = toDifyToolConfigs(draft.tools, draft.toolSettings).filter(
    (tool) => tool.provider_type === 'plugin',
  )
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 system-sm-medium text-text-secondary">
          <Switch
            checked={!!external}
            disabled={readOnly}
            onCheckedChange={(enabled) => {
              if (enabled) setOpen(true)
              else
                setDraft((current) => ({
                  ...current,
                  memory: { ...current.memory, external: null },
                }))
            }}
          />
          {t(($) => $['agentDetail.configure.memory.label'])}
        </label>
        {external && (
          <Button size="small" onClick={() => setOpen(true)}>
            {common(($) => $['operation.edit'])}
          </Button>
        )}
      </div>
      <p className="system-xs-regular text-text-tertiary">
        {t(($) => $['agentDetail.configure.memory.description'])}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <MemoryForm
            initial={external}
            tools={tools}
            readOnly={readOnly}
            onSave={(value) => {
              setDraft((current) => ({
                ...current,
                memory: { ...current.memory, external: value },
              }))
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
