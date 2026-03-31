import { DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import { BlockEnum } from '../types'
import {
  getInvalidNodeTypes,
  isImportCompleted,
  normalizeWorkflowFeatures,
  validateDSLContent,
} from '../update-dsl-modal.helpers'

describe('update-dsl-modal helpers', () => {
  describe('dsl validation', () => {
    it('should reject advanced chat dsl content with disallowed trigger nodes', () => {
      const content = `
workflow:
  graph:
    nodes:
      - data:
          type: trigger-webhook
`

      expect(validateDSLContent(content, AppModeEnum.ADVANCED_CHAT)).toBe(false)
    })

    it('should reject malformed yaml and answer nodes in non-advanced mode', () => {
      expect(validateDSLContent('[', AppModeEnum.CHAT)).toBe(false)
      expect(validateDSLContent(`
workflow:
  graph:
    nodes:
      - data:
          type: answer
`, AppModeEnum.CHAT)).toBe(false)
    })

    it('should accept valid node types for advanced chat mode', () => {
      expect(validateDSLContent(`
workflow:
  graph:
    nodes:
      - data:
          type: tool
`, AppModeEnum.ADVANCED_CHAT)).toBe(true)
    })

    it('should expose the invalid node sets per mode', () => {
      expect(getInvalidNodeTypes(AppModeEnum.ADVANCED_CHAT)).toEqual(
        expect.arrayContaining([BlockEnum.End, BlockEnum.TriggerWebhook]),
      )
      expect(getInvalidNodeTypes(AppModeEnum.CHAT)).toEqual([BlockEnum.Answer])
    })
  })

  describe('status and feature normalization', () => {
    it('should treat completed statuses as successful imports', () => {
      expect(isImportCompleted(DSLImportStatus.COMPLETED)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.COMPLETED_WITH_WARNINGS)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.PENDING)).toBe(false)
    })

    it('should normalize workflow features with defaults', () => {
      const features = normalizeWorkflowFeatures({
        file_upload: {
          image: {
            enabled: true,
          },
        },
        opening_statement: 'hello',
        suggested_questions: ['what can you do?'],
      })

      expect(features.file.enabled).toBe(true)
      expect(features.file.number_limits).toBe(3)
      expect(features.opening.enabled).toBe(true)
      expect(features.suggested).toEqual({ enabled: false })
      expect(features.text2speech).toEqual({ enabled: false })
    })
  })
})
