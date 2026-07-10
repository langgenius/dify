import { dslAppName, dslEnvVarSlots, encodeDslContent, isWorkflowDsl } from '../dsl'

describe('deployment DSL domain', () => {
  describe('content encoding', () => {
    it('should preserve Unicode content through base64 encoding', () => {
      const content = 'app:\n  name: 部署 🚀'

      const decoded = new TextDecoder().decode(Uint8Array.from(atob(encodeDslContent(content)), character => character.charCodeAt(0)))

      expect(decoded).toBe(content)
    })
  })

  describe('app metadata', () => {
    it('should trim the app name', () => {
      expect(dslAppName('app:\n  name: "  Deployment app  "')).toBe('Deployment app')
    })

    it('should return an empty app name for malformed content', () => {
      expect(dslAppName('app: [')).toBe('')
    })

    it('should identify workflow apps', () => {
      expect(isWorkflowDsl('app:\n  mode: workflow')).toBe(true)
    })

    it('should reject non-workflow apps', () => {
      expect(isWorkflowDsl('app:\n  mode: advanced-chat')).toBe(false)
    })
  })

  describe('environment variable slots', () => {
    it('should return no slots for malformed content', () => {
      expect(dslEnvVarSlots('workflow: [')).toEqual([])
    })

    it('should keep the first slot when names are duplicated', () => {
      const content = `
workflow:
  environment_variables:
    - name: REGION
      value: first
    - name: " REGION "
      value: second
`

      expect(dslEnvVarSlots(content)).toEqual([{
        key: 'REGION',
        defaultValue: 'first',
        hasDefaultValue: true,
      }])
    })

    it('should omit masked secret defaults', () => {
      const content = `
workflow:
  environment_variables:
    - name: API_KEY
      value: '[__HIDDEN__]'
      value_type: secret
`

      expect(dslEnvVarSlots(content)).toEqual([{
        key: 'API_KEY',
        valueType: 'secret',
      }])
    })

    it('should normalize unquoted timestamp defaults', () => {
      const content = `
workflow:
  environment_variables:
    - name: START_AT
      value: 2026-07-10T12:34:56Z
`

      expect(dslEnvVarSlots(content)).toEqual([{
        key: 'START_AT',
        defaultValue: '"2026-07-10T12:34:56.000Z"',
        hasDefaultValue: true,
      }])
    })

    it('should apply values inherited through YAML merge keys', () => {
      const content = `
defaults: &defaults
  description: Deployment region
  value: ap-southeast-1
  value_type: string
workflow:
  environment_variables:
    - <<: *defaults
      name: REGION
`

      expect(dslEnvVarSlots(content)).toEqual([{
        key: 'REGION',
        description: 'Deployment region',
        defaultValue: 'ap-southeast-1',
        hasDefaultValue: true,
        valueType: 'string',
      }])
    })
  })
})
