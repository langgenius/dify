import { useHooksStore } from '@/app/components/workflow/hooks-store'

export const useDSL = () => {
  const exportCheck = useHooksStore(s => s.exportCheck)
  const handleExportDSL = useHooksStore(s => s.handleExportDSL)

  return {
    exportCheck,
    handleExportDSL,
  }
}
