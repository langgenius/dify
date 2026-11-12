import type { HumanInputV2ErrorCategory } from '../../types'
import { HumanInputV2TransportError } from '../../errors'

export const createHumanInputV2Error = (
  category: HumanInputV2ErrorCategory,
  code = `human_input_${category.replaceAll('-', '_')}`,
  status?: number,
) => new HumanInputV2TransportError(category, code, status)
