import type { ModelUsageResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

type ModelUsageDialogProps = {
  provider: string
  model: string
}

const getAppHref = (usage: ModelUsageResponse) => {
  if (usage.app_mode === 'workflow' || usage.app_mode === 'advanced-chat')
    return `/app/${usage.app_id}/workflow`
  return `/app/${usage.app_id}/configuration`
}

function ModelUsageList({ provider, model }: ModelUsageDialogProps) {
  const { t } = useTranslation(['modelProvider', 'common'])
  const { data, isError } = useQuery(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.usages.get.queryOptions({
      input: { params: { provider }, query: { model, model_type: 'llm' } },
    }),
  )

  if (isError)
    return (
      <p role="alert" className="system-sm-regular text-text-destructive">
        {t(($) => $['api.actionFailed'], { ns: 'common' })}
      </p>
    )
  if (!data)
    return (
      <p role="status" className="system-sm-regular text-text-tertiary">
        {t(($) => $.loading, { ns: 'common' })}
      </p>
    )
  if (!data.data.length && !data.inaccessible_count)
    return (
      <p className="system-sm-regular text-text-tertiary">
        {t(($) => $['modelProvider.usage.empty'], { ns: 'modelProvider' })}
      </p>
    )
  return (
    <div className="flex flex-col gap-2">
      {data.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {data.data.map((usage) => (
            <li
              key={`${usage.app_id}:${usage.source}:${usage.node_id ?? ''}`}
              className="flex flex-col rounded-lg bg-components-panel-on-panel-item-bg px-3 py-2"
            >
              <Link
                href={getAppHref(usage)}
                className="w-fit system-sm-medium text-text-accent hover:underline"
              >
                {usage.app_name}
              </Link>
              <span className="system-xs-regular text-text-tertiary">
                {t(($) => $[`modelProvider.usage.source.${usage.source}`], { ns: 'modelProvider' })}
                {usage.node_title && ` · ${usage.node_title}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.inaccessible_count > 0 && (
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['modelProvider.usage.inaccessible'], {
            ns: 'modelProvider',
            count: data.inaccessible_count,
          })}
        </p>
      )}
    </div>
  )
}

export function ModelUsageDialog({ provider, model }: ModelUsageDialogProps) {
  const { t } = useTranslation(['modelProvider', 'common'])

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="small"
            className="me-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <span aria-hidden className="i-ri-node-tree size-4" />
            {t(($) => $['modelProvider.usage.view'], { ns: 'modelProvider' })}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['modelProvider.usage.title'], { ns: 'modelProvider', model })}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $['modelProvider.usage.description'], { ns: 'modelProvider' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <ModelUsageList provider={provider} model={model} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
