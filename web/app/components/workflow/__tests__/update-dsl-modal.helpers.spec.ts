import { renderHook } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { DSLImportStatus } from '@/models/app'
import {
  getImportNotificationPayload,
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
  })

  describe('status and feature normalization', () => {
    it('should treat completed statuses as successful imports', () => {
      expect(isImportCompleted(DSLImportStatus.COMPLETED)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.COMPLETED_WITH_WARNINGS)).toBe(true)
      expect(isImportCompleted(DSLImportStatus.PENDING)).toBe(false)
    })

    it('should use the warning fallback in the import notification', () => {
      const { result } = renderHook(() => useTranslation(['workflow']))

      const payload = getImportNotificationPayload(
        DSLImportStatus.COMPLETED_WITH_WARNINGS,
        result.current.t,
      )

      expect(payload).toEqual({
        type: 'warning',
        message: 'workflow.common.importWarning',
        children: 'workflow.common.importWarningDetails',
      })
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
