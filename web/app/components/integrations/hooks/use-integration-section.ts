import type { IntegrationSection } from '@/app/components/integrations/routes'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import {
  INTEGRATION_SECTION_VALUES,
  sectionByToolCategory,
  TOOL_CATEGORY_VALUES,
} from '@/app/components/integrations/routes'
import { useFileScanEnabled } from '@/features/file-scan/provider-types'

const parseAsIntegrationSection = parseAsStringLiteral(INTEGRATION_SECTION_VALUES)
const parseAsToolCategory = parseAsStringLiteral(TOOL_CATEGORY_VALUES)

export function useIntegrationSection(routeSection?: IntegrationSection) {
  const [sectionParam] = useQueryState('section', parseAsIntegrationSection)
  const [categoryParam] = useQueryState('category', parseAsToolCategory)

  const fileScanEnabled = useFileScanEnabled()
  const section =
    routeSection ??
    sectionParam ??
    (categoryParam ? sectionByToolCategory[categoryParam] : 'provider')

  // The malware scanners section does not exist while the workspace has the feature turned off.
  return section === 'file-scan' && !fileScanEnabled ? 'provider' : section
}
