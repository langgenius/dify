import { describe, expect, it } from 'vite-plus/test'
import { findValueIssues, formatValueIssue } from '../check-i18n-values'

describe('check-i18n-values', () => {
  describe('findValueIssues', () => {
    it('should accept a translation that keeps every placeholder and tag', () => {
      // Arrange
      const source = {
        'invite.sent': 'Invitation sent to {{email}}',
        'plan.docs': '{{count,number}} documents',
        'encrypted.front': 'Your API KEY will be encrypted using <techLink>PKCS1_OAEP</techLink>',
      }
      const translation = {
        'invite.sent': '{{email}} adresine davet gönderildi',
        'plan.docs': '{{count,number}} belge',
        'encrypted.front':
          'API anahtarınız <techLink>PKCS1_OAEP</techLink> kullanılarak şifrelenecek',
      }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([])
    })

    it('should report a placeholder the translation dropped', () => {
      // Arrange
      const source = { 'invite.sent': 'Invitation sent to {{email}}' }
      const translation = { 'invite.sent': 'Davet gönderildi' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        { key: 'invite.sent', kind: 'placeholder', expected: ['{{email}}'], actual: [] },
      ])
    })

    it('should report a placeholder the translation renamed', () => {
      // Arrange
      const source = { 'workspace.limit': 'Upgrade from {{free}} to Pro' }
      const translation = { 'workspace.limit': "{{hobby}} planından Pro'ya yükseltin" }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        {
          key: 'workspace.limit',
          kind: 'placeholder',
          expected: ['{{free}}'],
          actual: ['{{hobby}}'],
        },
      ])
    })

    it('should report a placeholder the translation invented', () => {
      // Arrange
      const source = { 'goal.editCriterion': 'Edit criterion' }
      const translation = { 'goal.editCriterion': 'Kriteri düzenle C{{seq}}' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        { key: 'goal.editCriterion', kind: 'placeholder', expected: [], actual: ['{{seq}}'] },
      ])
    })

    it('should report a dropped tag separately from placeholders', () => {
      // Arrange
      const source = { 'payment.switched': 'Switched from <bold>{{from}}</bold> to {{to}}' }
      const translation = { 'payment.switched': '{{from}} planından {{to}} planına geçildi' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        {
          key: 'payment.switched',
          kind: 'tag',
          expected: ['</bold>', '<bold>'],
          actual: [],
        },
      ])
    })

    it('should accept placeholders reordered by the target language word order', () => {
      // Arrange
      const source = { 'usage.window': '{{used}} of {{total}} used' }
      const translation = { 'usage.window': '{{total}} içinden {{used}} kullanıldı' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([])
    })

    it('should report a repeated placeholder that appears a different number of times', () => {
      // Arrange
      const source = { 'quota.hint': '{{name}} is full. Free up space in {{name}}.' }
      const translation = { 'quota.hint': '{{name}} dolu. Yer açın.' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        {
          key: 'quota.hint',
          kind: 'placeholder',
          expected: ['{{name}}', '{{name}}'],
          actual: ['{{name}}'],
        },
      ])
    })

    it('should ignore keys that are missing from the translation', () => {
      // Arrange
      const source = { present: 'Sent to {{email}}', absent: 'Retry in {{minutes}}' }
      const translation = { present: '{{email}} adresine gönderildi' }

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([])
    })

    it('should report a key whose translation is present but not a string', () => {
      // Arrange
      // The key check is satisfied by the key alone, so nothing else would
      // notice that the sentence and its placeholder are gone.
      const source = { 'invite.sent': 'Sent to {{email}}' }
      const translation = { 'invite.sent': null } as Record<string, unknown>

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([
        { key: 'invite.sent', kind: 'placeholder', expected: ['{{email}}'], actual: [] },
      ])
    })

    it('should accept a non-string translation when the source carries no marker', () => {
      // Arrange
      const source = { 'plan.name': 'Sandbox' }
      const translation = { 'plan.name': 42 } as Record<string, unknown>

      // Act
      const issues = findValueIssues(source, translation)

      // Assert
      expect(issues).toEqual([])
    })
  })

  describe('formatValueIssue', () => {
    it('should name the file, key and both sides of a placeholder mismatch', () => {
      // Arrange
      const issue = {
        key: 'invite.sent',
        kind: 'placeholder' as const,
        expected: ['{{email}}'],
        actual: [],
      }

      // Act
      const line = formatValueIssue('common', issue)

      // Assert
      expect(line).toBe('common.invite.sent: expected placeholders {{email}}, found (none)')
    })
  })
})
