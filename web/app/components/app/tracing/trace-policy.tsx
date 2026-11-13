import type { AppTracePayload, AppTraceResponse } from '@dify/contracts/api/console/apps/types.gen'
import { Collapsible, CollapsiblePanel } from '@langgenius/dify-ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Switch } from '@langgenius/dify-ui/switch'
import { useTranslation } from 'react-i18next'
import { SummaryDisclosureTrigger } from './summary-disclosure'

const policyFields = [
  {
    name: 'capture_content',
    label: 'tracing.captureContent',
    description: 'tracing.captureContentDescription',
  },
  {
    name: 'capture_agent',
    label: 'tracing.captureAgent',
    description: 'tracing.captureAgentDescription',
  },
] as const

/** Capture settings of the resource that owns the Agent trace pipeline, collapsed until opened. */
export function TracePolicy({
  policy,
  readOnly,
  onChange,
}: {
  policy?: AppTraceResponse
  readOnly: boolean
  onChange: (changes: Partial<AppTracePayload>) => Promise<void>
}) {
  const { t } = useTranslation(['app'])
  const title = t(($) => $['tracing.captureTitle'], { ns: 'app' })
  // Backend defaults until the policy is known.
  const values = {
    capture_content: policy?.capture_content ?? false,
    capture_agent: policy?.capture_agent ?? true,
  }

  return (
    <Collapsible>
      <SummaryDisclosureTrigger label={title} />
      <CollapsiblePanel>
        <Fieldset className="pt-1">
          <FieldsetLegend className="sr-only">{title}</FieldsetLegend>
          {policyFields.map(({ name, label, description }) => (
            <Field key={name} className="flex flex-row items-center justify-between gap-4 py-1.5">
              <div className="min-w-0">
                <FieldLabel className="system-sm-regular text-text-secondary">
                  {t(($) => $[label], { ns: 'app' })}
                </FieldLabel>
                <FieldDescription className="system-xs-regular text-text-tertiary">
                  {t(($) => $[description], { ns: 'app' })}
                </FieldDescription>
              </div>
              <Switch
                readOnly={readOnly}
                checked={values[name]}
                onCheckedChange={(checked) => {
                  void onChange({ [name]: checked }).catch(() => {})
                }}
              />
            </Field>
          ))}
        </Fieldset>
      </CollapsiblePanel>
    </Collapsible>
  )
}
