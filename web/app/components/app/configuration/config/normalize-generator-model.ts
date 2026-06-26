import type { Model } from '@/types/app'
import { AppModeEnum, ModelModeType } from '@/types/app'

export const normalizeGeneratorModel = (model: Model): Model => {
  const mode = model.mode as string

  if (mode === AppModeEnum.COMPLETION || mode === ModelModeType.completion)
    return { ...model, mode: ModelModeType.completion }

  return { ...model, mode: ModelModeType.chat }
}
