import type { KnowledgeFsPublicFailureResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { KnowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'
import { Suspense } from 'react'
import { Translation } from 'react-i18next'
import { knowledgeFsTaskFailureDetail } from '../knowledge-fs-task-error'

// Successful task rows never request the failure catalog, on the server or client.
export function KnowledgeTaskFailure({
  messageKey,
  failure,
}: {
  messageKey: KnowledgeFsTaskFailureMessageKey
  failure?: KnowledgeFsPublicFailureResponse
}) {
  return (
    <Suspense fallback={null}>
      <Translation ns={['knowledgeErrors']}>
        {(t) => {
          const detail = knowledgeFsTaskFailureDetail(failure, t)
          return (
            <>
              <p className="mt-1 system-2xs-regular wrap-break-word whitespace-pre-wrap text-text-destructive">
                {t(($) => $[messageKey])}
              </p>
              {detail && (
                <p className="mt-0.5 system-2xs-regular wrap-break-word text-text-quaternary">
                  {detail}
                </p>
              )}
            </>
          )
        }}
      </Translation>
    </Suspense>
  )
}
