import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import SystemModel from '../model-page/system-model'
import { fetchModelProviders } from '@/service/common'
import { useProviderContext } from '@/context/provider-context'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

const ModelProviderPage = () => {
  const { t } = useTranslation()
  const {
    updateModelList,
    textGenerationDefaultModel,
    embeddingsDefaultModel,
    speech2textDefaultModel,
    rerankDefaultModel,
  } = useProviderContext()
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const defaultModelNotConfigured = !textGenerationDefaultModel && !embeddingsDefaultModel && !speech2textDefaultModel && !rerankDefaultModel

  return (
    <div className='relative pt-1 -mt-2'>
      <div className={`flex items-center justify-between mb-2 h-8 ${defaultModelNotConfigured && 'px-3 bg-[#FFFAEB] rounded-lg border border-[#FEF0C7]'}`}>
        {
          defaultModelNotConfigured
            ? (
              <div className='flex items-center text-xs font-medium text-gray-700'>
                <AlertTriangle className='mr-1 w-3 h-3 text-[#F79009]' />
                {t('common.modelProvider.notConfigured')}
              </div>
            )
            : <div className='text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
        }
        <SystemModel onUpdate={() => mutateProviders()} />
      </div>
    </div>
  )
}

export default ModelProviderPage
