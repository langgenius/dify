import type { ExternalTestFileAccessResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { TestAgentRun } from './use-test-run'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { asRecord, stringValue } from '../../model'

type FileAccess = NonNullable<TestAgentRun['fileAccess']>
const isFile = (value: unknown) => {
  const record = asRecord(value)
  return record.dify_model_identity === '__dify__file__' && !!stringValue(record.upload_file_id)
}
const containsFile = (value: unknown): boolean =>
  isFile(value) ||
  (Array.isArray(value)
    ? value.some(containsFile)
    : Object.values(asRecord(value)).some(containsFile))

function SignedResultFile({
  fileId,
  name,
  access,
  initialAccess,
}: {
  fileId: string
  name: string
  access: FileAccess
  initialAccess: ExternalTestFileAccessResponse
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const downloadControllerRef = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      downloadControllerRef.current?.abort()
    },
    [],
  )
  const link = useQuery(
    consoleQuery.externalAgents.byAgentId.tests.byInvocationId.files.byFileId.access.get.queryOptions(
      {
        input: {
          params: {
            agent_id: access.agentId,
            invocation_id: access.invocationId,
            file_id: fileId,
          },
          query: {
            page_session_id: access.pageSessionId,
            expected_generation: access.generation,
          },
        },
        context: { silent: true },
        initialData: initialAccess,
        gcTime: 0,
        retry: false,
        staleTime: (query) =>
          Math.max(
            0,
            Date.parse(query.state.data?.url_expires_at ?? '') - query.state.dataUpdatedAt,
          ) || 0,
        refetchInterval: (query) => {
          const expiresAt = Date.parse(query.state.data?.url_expires_at ?? '')
          if (
            query.state.fetchStatus === 'fetching' ||
            query.state.status === 'error' ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= query.state.dataUpdatedAt
          )
            return false
          return Math.min(2_147_483_647, Math.max(1, expiresAt - Date.now()))
        },
      },
    ),
  )
  const download = useMutation({
    retry: false,
    gcTime: 0,
    mutationFn: async ({ url, controller }: { url: string; controller: AbortController }) => {
      // Signed file bytes are public to the bearer URL; never forward Console credentials.
      // oxlint-disable-next-line no-restricted-globals -- Download bytes from the signed URL returned by the generated access API; this is not a handwritten Console endpoint.
      const response = await fetch(url, { credentials: 'omit', signal: controller.signal })
      if (!response.ok) throw new Error(`File download failed: ${response.status}`)
      const data = await response.blob()
      controller.signal.throwIfAborted()
      downloadBlob({ data, fileName: name })
    },
  })
  const url = link.data?.file_id === fileId ? link.data.url : ''
  const protocol = URL.parse(url, globalThis.location?.href)?.protocol
  const available =
    !link.isError &&
    !link.isFetching &&
    !link.isStale &&
    !!url &&
    (protocol === 'http:' || protocol === 'https:') &&
    !!link.data?.url_expires_at
  return (
    <div className="rounded-lg border border-divider-subtle p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="i-ri-file-line size-5 shrink-0 text-text-tertiary" />
        {available ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 rounded-sm system-sm-medium wrap-anywhere text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active"
          >
            {name}
          </a>
        ) : (
          <span className="min-w-0 flex-1 system-sm-medium wrap-anywhere">{name}</span>
        )}
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={!available || download.isPending}
          loading={download.isPending}
          onClick={() => {
            if (!available) return
            downloadControllerRef.current?.abort()
            const controller = new AbortController()
            downloadControllerRef.current = controller
            download.mutate({ url, controller })
          }}
        >
          {t(($) => $['operation.download'], { ns: 'common' })}
        </Button>
      </div>
      {!available && (
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {link.isFetching
            ? t(($) => $.loading, { ns: 'common' })
            : t(($) => $['external.overview.testRun.resultFileUnavailable'])}
        </p>
      )}
      {download.isError && (
        <p className="mt-1 system-xs-regular text-text-destructive">
          {t(($) => $['operation.downloadFailed'], { ns: 'common' })}
        </p>
      )}
    </div>
  )
}

export function TestAgentOutputValue({
  value,
  access,
}: {
  value: unknown
  access: TestAgentRun['fileAccess']
}) {
  const { t } = useTranslation(['agentRoster'])
  const file = asRecord(value)
  if (isFile(value)) {
    const id = stringValue(file.upload_file_id)
    const name = stringValue(file.filename) || id
    const url = stringValue(file.url)
    const expires = stringValue(file.url_expires_at)
    return access && url && expires ? (
      <SignedResultFile
        key={`${access.agentId}:${access.pageSessionId}:${access.generation}:${access.invocationId}:${id}`}
        fileId={id}
        name={name}
        access={access}
        initialAccess={{ file_id: id, url, url_expires_at: expires }}
      />
    ) : (
      <div className="rounded-lg border border-divider-subtle p-3">
        <p className="system-sm-medium wrap-anywhere">{name}</p>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.testRun.resultFileUnavailable'])}
        </p>
      </div>
    )
  }
  if (typeof value === 'string') return <p className="whitespace-pre-wrap">{value}</p>
  if (containsFile(value)) {
    return (
      <div className="space-y-2">
        {Object.entries(value ?? {}).map(([name, item]) => (
          <div key={name}>
            {!Array.isArray(value) && (
              <h5 className="mb-1 system-xs-medium text-text-tertiary">{name}</h5>
            )}
            <TestAgentOutputValue value={item} access={access} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-background-section p-2 system-xs-regular wrap-anywhere whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
