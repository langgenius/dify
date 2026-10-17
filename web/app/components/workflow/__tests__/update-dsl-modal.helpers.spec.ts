import { DSLImportStatus } from '@/models/app'
import { BlockEnum } from '../types'
import {
  getImportNotificationPayload,
  getInvalidNodeTypes,
  isImportCompleted,
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

      expect(validateDSLContent(content, 'advanced-chat')).toBe(false)
    })

    it('should reject disallowed node types inherited through YAML merge keys', () => {
      const content = `
trigger: &trigger
  type: trigger-webhook
workflow:
  graph:
    nodes:
      - data:
          <<: *trigger
`

      expect(validateDSLContent(content, 'advanced-chat')).toBe(false)
    })

    it('should reject malformed yaml and answer nodes in non-advanced mode', () => {
      expect(validateDSLContent('[', 'chat')).toBe(false)
      expect(
        validateDSLContent(
          `
workflow:
  graph:
    nodes:
      - data:
          type: answer
`,
          'chat',
        ),
      ).toBe(false)
    })

    it('should accept valid node types for advanced chat mode', () => {
      expect(
        validateDSLContent(
          `
workflow:
  graph:
    nodes:
      - data:
          type: tool
`,
          'advanced-chat',
        ),
      ).toBe(true)
    })

    it('should accept empty yaml content', () => {
      expect(validateDSLContent('', 'chat')).toBe(true)
    })

    it('should accept comment-only yaml content', () => {
      expect(validateDSLContent('# No document', 'chat')).toBe(true)
    })

    it('should reject yaml streams with multiple documents', () => {
      expect(validateDSLContent('---\n{}\n---\n{}', 'chat')).toBe(false)
    })

    it('should expose the invalid node sets per mode', () => {
      expect(getInvalidNodeTypes('advanced-chat')).toEqual(
        expect.arrayContaining([BlockEnum.End, BlockEnum.TriggerWebhook]),
      )
      expect(getInvalidNodeTypes('chat')).toEqual([BlockEnum.Answer])
    })
  })

  describe('status and feature normalization', () => {
    it('should treat completed statuses as successful imports', () => {
      expect(isImportCompleted(DSLImportStatus.COMPLETED)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.COMPLETED_WITH_WARNINGS)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.PENDING)).toBe(false)
    })

    it('should use the warning fallback in the import notification', () => {
      const t = ((key: (selector: Record<string, string>) => string) =>
        key({
          'common.importSuccess': 'Import succeeded',
          'common.importWarning': 'Caution',
          'common.importWarningDetails': 'Some configuration may need attention',
        })) as never

      const payload = getImportNotificationPayload(DSLImportStatus.COMPLETED_WITH_WARNINGS, t)

      expect(payload).toEqual({
        type: 'warning',
        message: 'Caution',
        children: 'Some configuration may need attention',
      })
    })
  })
})
