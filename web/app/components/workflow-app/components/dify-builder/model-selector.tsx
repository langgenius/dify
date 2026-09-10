import type { SessionModel } from './types'
import type { useDifyBuilderModel } from './use-dify-builder-model'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { difyBuilderModelReadonlyAtom, difyBuilderSelectModelAtom } from './store'

type DifyBuilderModelSelectorProps = ReturnType<typeof useDifyBuilderModel>

const DifyBuilderModelSelector = ({ model, modelList }: DifyBuilderModelSelectorProps) => {
  const { t } = useTranslation()
  const readonly = useAtomValue(difyBuilderModelReadonlyAtom)
  const selectModel = useSetAtom(difyBuilderSelectModelAtom)

  const commitModel = (nextModel: SessionModel) => {
    void selectModel(nextModel)
  }

  return (
    <ModelParameterModal
      provider={model?.provider ?? ''}
      modelId={model?.name ?? ''}
      completionParams={(model?.completion_params ?? {}) as FormValue}
      modelList={modelList}
      popupClassName="w-[340px]! max-w-[340px]!"
      placement="top-start"
      isAdvancedMode
      isInWorkflow
      readonly={readonly}
      modelSelectorReadonly={readonly}
      setModel={({ provider, modelId, mode }) => {
        const completionParams =
          model?.provider === provider && model.name === modelId
            ? (model.completion_params ?? {})
            : {}
        commitModel({
          provider,
          name: modelId,
          mode: mode ?? '',
          completion_params: completionParams,
        })
      }}
      onCompletionParamsChange={(completionParams) => {
        if (!model) return
        commitModel({ ...model, completion_params: completionParams })
      }}
      hideDebugWithMultipleModel
      debugWithMultipleModel={false}
      trigger={
        <button
          type="button"
          disabled={readonly}
          className="flex min-w-0 items-center gap-0.5 rounded-md p-1 text-left system-xs-regular text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="max-w-36 truncate">
            {model?.name || t(($) => $['modelProvider.model'], { ns: 'common' })}
          </span>
          <span
            aria-hidden
            className="i-ri-arrow-down-s-line size-3.5 shrink-0 text-text-tertiary"
          />
        </button>
      }
    />
  )
}

export default DifyBuilderModelSelector
