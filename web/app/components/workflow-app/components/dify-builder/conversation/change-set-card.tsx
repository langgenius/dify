import type { ChangeSetCard as ChangeSet } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'

export const ChangeSetCard = ({
  payload,
  invalidated,
}: {
  payload: ChangeSet
  invalidated: boolean
}) => {
  const { t } = useTranslation()
  const nodes = payload.nodes ?? []
  return (
    <DifyBuilderCard
      category={t(($) => $['difyBuilder.changes'], { ns: 'workflow' })}
      headline={
        nodes.length > 0 ? t(($) => $['difyBuilder.affectedNodes'], { ns: 'workflow' }) : undefined
      }
      invalidated={invalidated}
      meta={nodes.length > 0 ? String(nodes.length) : undefined}
    >
      <div className="flex flex-col gap-3">
        {nodes.length > 0 && (
          <ol
            aria-label={t(($) => $['difyBuilder.affectedNodes'], { ns: 'workflow' })}
            className="flex flex-col py-1"
          >
            {nodes.map((node, index) => (
              <li key={node.node_id} className="flex items-start gap-4 py-1">
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-md bg-components-badge-bg-gray-soft system-2xs-semibold-uppercase text-text-tertiary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="system-sm-regular wrap-anywhere text-text-primary">
                    {node.title || node.node_id}
                  </div>
                  {node.title && node.title !== node.node_id && (
                    <div className="mt-0.5 font-mono text-[11px] wrap-anywhere text-text-tertiary">
                      {node.node_id}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {payload.changes.length > 0 && (
          <div>
            {nodes.length > 0 && (
              <h4 className="mb-2 system-xs-medium text-text-tertiary">
                {t(($) => $['difyBuilder.changeDetails'], { ns: 'workflow' })}
              </h4>
            )}
            <ol
              aria-label={t(($) => $['difyBuilder.changeDetails'], { ns: 'workflow' })}
              className="flex flex-col py-1"
            >
              {payload.changes.map((change, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- Change summaries are immutable and may repeat.
                <li key={index} className="flex items-start gap-4 py-1">
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-md bg-components-badge-bg-gray-soft system-2xs-semibold-uppercase text-text-tertiary"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 system-sm-regular wrap-anywhere whitespace-pre-wrap text-text-primary">
                    {change}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {nodes.length === 0 && payload.changes.length === 0 && (
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['difyBuilder.noChanges'], { ns: 'workflow' })}
          </p>
        )}
      </div>
    </DifyBuilderCard>
  )
}
