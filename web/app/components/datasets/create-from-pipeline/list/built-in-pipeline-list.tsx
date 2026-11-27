import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { selectPipelineTemplateList } from '@/app/components/rag-pipeline/utils/query-select'
import { useMarketplace } from '@/features/marketplace/client'
import { LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import CreateCard from './create-card'
import TemplateCard from './template-card'

const BuiltInPipelineList = () => {
  const { t } = useTranslation(['common', 'dataset'])
  const locale = useLocale()
  const language = useMemo(() => {
    if (['zh-Hans', 'ja-JP'].includes(locale)) return locale
    return LanguagesSupported[0]
  }, [locale])
  const enableMarketplace = useMarketplace() !== null
  const pipelineListQuery = useQuery(
    consoleQuery.rag.pipeline.templates.get.queryOptions({
      input: { query: { type: 'built-in', language } },
      enabled: enableMarketplace,
      select: selectPipelineTemplateList,
    }),
  )
  const { data: pipelineList, isLoading } = pipelineListQuery
  const list = pipelineList?.pipeline_templates || []
  const pipelineListLoad = useOwnedQueryError(pipelineListQuery)
  const loadErrorMessage = useRequestErrorMessage(
    pipelineListLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )

  return (
    <>
      {pipelineListLoad && (
        <Alert type="error" className="mt-2">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              loading={pipelineListLoad.retrying}
              onClick={pipelineListLoad.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-3 py-2">
        <CreateCard />
        {!isLoading &&
          list.map((pipeline) => (
            <TemplateCard key={pipeline.id} type="built-in" pipeline={pipeline} />
          ))}
      </div>
    </>
  )
}

export default BuiltInPipelineList
