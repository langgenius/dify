import type { FileResponse } from '@/types/workflow'
import { useTranslation } from 'react-i18next'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'
import { useDifyBuilderInteractionLocale } from '../interactions/use-interaction-locale'

const isOutputFile = (value: unknown): value is FileResponse =>
  typeof value === 'object' &&
  value !== null &&
  'dify_model_identity' in value &&
  value.dify_model_identity === '__dify__file__'

const OutputValue = ({ value }: { value: unknown }) => {
  const files = isOutputFile(value)
    ? [value]
    : Array.isArray(value) && value.length > 0 && value.every(isOutputFile)
      ? value
      : null
  if (files)
    return (
      <FileList
        files={getProcessedFilesFromResponse(files)}
        showDeleteAction={false}
        showDownloadAction
        canPreview
      />
    )
  if (typeof value === 'string' && value !== '')
    return (
      <ChatContextProvider chatList={[]} isResponding={false}>
        <Markdown content={value} mode="static" className="text-sm! leading-5! wrap-anywhere" />
      </ChatContextProvider>
    )
  return (
    <pre className="rounded-md bg-background-section p-2 font-mono wrap-anywhere whitespace-pre-wrap text-text-primary">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export const TestResultOutputs = ({ outputs }: { outputs: unknown }) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const entries =
    typeof outputs === 'object' && outputs !== null && !Array.isArray(outputs)
      ? Object.entries(outputs)
      : null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {outputs == null || entries?.length === 0 ? (
        <p>{t(($) => $['testResult.noOutputs'], { ns: 'difyBuilder' })}</p>
      ) : entries ? (
        <dl className="flex min-w-0 flex-col gap-3">
          {entries.map(([name, value]) => (
            <div key={name} className="min-w-0">
              <dt className="mb-1 system-xs-medium wrap-anywhere text-text-tertiary">{name}</dt>
              <dd className="min-w-0">
                <OutputValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <OutputValue value={outputs} />
      )}
    </div>
  )
}
