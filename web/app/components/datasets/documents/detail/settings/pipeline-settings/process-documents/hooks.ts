import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'

export const useConfigurations = (documentdId: string) => {
  const initialData: Record<string, any> = {}
  const configurations: BaseConfiguration[] = []

  return {
    initialData,
    configurations,
  }
}
