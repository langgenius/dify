'use client'
import type {
  AppTracePayload,
  AppTraceResponse,
  TraceAppConfigResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { ProviderConfigError } from './provider-panel'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentTracePolicy } from './agent-trace-policy'
import ProviderConfigModal from './provider-config-modal'
import ProviderPanel from './provider-panel'
import { configurableProviders } from './providers'

export type PopupProps = {
  resource: TracingResource
  configErrors?: Partial<Record<ConfigurableTracingProvider, ProviderConfigError>>
  onBeforeRemove: (provider: ConfigurableTracingProvider) => Promise<void>
  readOnly: boolean
  enabled: boolean
  pending: boolean
  policyError?: string
  policy?: AppTraceResponse
  onPolicyChange: (changes: Partial<AppTracePayload>) => Promise<void>
  onStatusChange: (enabled: boolean) => void
  chosenProvider: ConfigurableTracingProvider | null
  onChooseProvider: (provider: ConfigurableTracingProvider) => Promise<void>
  configs: Partial<Record<ConfigurableTracingProvider, TraceAppConfigResponse['tracing_config']>>
}

export default function ConfigPopup({
  resource,
  configErrors,
  onBeforeRemove,
  readOnly,
  enabled,
  pending,
  policyError,
  policy,
  onPolicyChange,
  onStatusChange,
  chosenProvider,
  onChooseProvider,
  configs,
}: PopupProps) {
  const { t } = useTranslation(['app'])
  const dialogActionsRef = useRef<DialogActions>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const closeConfig = () => dialogActionsRef.current?.close()
  const groups = [
    configurableProviders.filter((provider) => !!configs[provider]),
    configurableProviders.filter((provider) => !configs[provider]),
  ]
  return (
    <Dialog<ConfigurableTracingProvider> actionsRef={dialogActionsRef} disablePointerDismissal>
      {({ payload: provider }) => (
        <>
          <div className="max-h-[calc(100dvh-8rem)] w-105 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <PopoverTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['tracing.tracing'])}
              </PopoverTitle>
              <Switch
                aria-label={t(($) => $['tracing.tracing'])}
                checked={enabled}
                onCheckedChange={onStatusChange}
                disabled={
                  readOnly || pending || (!enabled && (!chosenProvider || !configs[chosenProvider]))
                }
              />
            </div>
            <PopoverDescription className="mt-2 system-xs-regular text-text-tertiary">
              {t(($) => $['tracing.tracingDescription'])}
            </PopoverDescription>
            {policyError && (
              <p role="alert" className="mt-2 system-sm-regular text-text-destructive">
                {policyError}
              </p>
            )}
            {resource.kind === 'agent' && (
              <AgentTracePolicy
                agentId={resource.agentId}
                policy={policy}
                readOnly={readOnly}
                pending={pending}
                onChange={onPolicyChange}
              />
            )}
            <Separator className="my-3" />
            {readOnly ? (
              <p className="system-sm-regular text-text-secondary">
                {chosenProvider
                  ? t(($) => $[`tracing.${chosenProvider}.title`])
                  : t(($) => $['tracing.configProviderTitle.notConfigured'])}
              </p>
            ) : (
              <div className="space-y-2">
                {groups.flatMap((group, index) =>
                  group.length > 0
                    ? [
                        <h4
                          key={index === 0 ? 'configured' : 'available'}
                          className="mt-3 system-xs-medium-uppercase text-text-tertiary"
                        >
                          {t(
                            ($) =>
                              $[
                                `tracing.configProviderTitle.${index === 0 ? 'configured' : 'notConfigured'}`
                              ],
                          )}
                        </h4>,
                        ...group.map((item) => (
                          <ProviderPanel
                            key={item}
                            type={item}
                            readOnly={readOnly}
                            pending={pending}
                            config={configs[item]}
                            configError={configErrors?.[item]}
                            isChosen={chosenProvider === item}
                            onChoose={() => {
                              void onChooseProvider(item).catch(() => {})
                            }}
                          />
                        )),
                      ]
                    : [],
                )}
              </div>
            )}
          </div>
          {!readOnly && (
            <DialogContent
              initialFocus={firstInputRef}
              className="max-h-[calc(100dvh-2rem)] w-160 p-0"
            >
              {provider && (
                <ProviderConfigModal
                  resource={resource}
                  type={provider}
                  payload={configs[provider]}
                  firstInputRef={firstInputRef}
                  onSaved={closeConfig}
                  onChosen={onChooseProvider}
                  onBeforeRemove={() => onBeforeRemove(provider)}
                  onRemoved={closeConfig}
                />
              )}
            </DialogContent>
          )}
        </>
      )}
    </Dialog>
  )
}
