import type { InputForm } from '../type'
import { InputVarType } from '@/app/components/workflow/types'
import { getProcessedInputs, processInputFileFromServer, processOpeningStatement } from '../utils'

vi.mock('@/app/components/base/file-uploader/utils', () => ({
  getProcessedFiles: vi.fn((files: File[]) => files.map((f: File) => ({ ...f, processed: true }))),
}))

describe('chat/chat/utils.ts', () => {
  describe('processOpeningStatement', () => {
    it('returns empty string if openingStatement is falsy', () => {
      expect(processOpeningStatement('', {}, [])).toBe('')
    })

    it('replaces variables with input values when available', () => {
      const result = processOpeningStatement('Hello {{name}}', { name: 'Alice' }, [])
      expect(result).toBe('Hello Alice')
    })

    it('replaces variables with labels when input value is not available but form has variable', () => {
      const result = processOpeningStatement('Hello {{user_name}}', {}, [{ variable: 'user_name', label: 'Name Label', type: InputVarType.textInput }] as InputForm[])
      expect(result).toBe('Hello {{Name Label}}')
    })

    it('keeps original match when input value and form are not available', () => {
      const result = processOpeningStatement('Hello {{unknown}}', {}, [])
      expect(result).toBe('Hello {{unknown}}')
    })
  })

  describe('processInputFileFromServer', () => {
    it('maps server file object to local schema', () => {
      const result = processInputFileFromServer({
        type: 'image',
        transfer_method: 'local_file',
        remote_url: 'http://example.com/img.png',
        related_id: '123',
      })

      expect(result).toEqual({
        type: 'image',
        transfer_method: 'local_file',
        url: 'http://example.com/img.png',
        upload_file_id: '123',
      })
    })
  })

  describe('getProcessedInputs', () => {
    it('processes checkbox input types to boolean', () => {
      const inputs = { terms: 'true', conds: null }
      const inputsForm = [
        { variable: 'terms', type: InputVarType.checkbox as string },
        { variable: 'conds', type: InputVarType.checkbox as string },
      ]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result).toEqual({ terms: true, conds: false })
    })

    it('ignores null values', () => {
      const inputs = { test: null }
      const inputsForm = [{ variable: 'test', type: InputVarType.textInput as string }]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result).toEqual({ test: null })
    })

    it('processes singleFile using transfer_method logic', () => {
      const inputs = {
        file1: { transfer_method: 'local_file', url: '1' },
        file2: { id: 'file2' },
      }
      const inputsForm = [
        { variable: 'file1', type: InputVarType.singleFile as string },
        { variable: 'file2', type: InputVarType.singleFile as string },
      ]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result.file1).toHaveProperty('transfer_method', 'local_file')
      expect(result.file2).toHaveProperty('processed', true)
    })

    it('processes multiFiles using transfer_method logic', () => {
      const inputs = {
        files1: [{ transfer_method: 'local_file', url: '1' }],
        files2: [{ id: 'file2' }],
      }
      const inputsForm = [
        { variable: 'files1', type: InputVarType.multiFiles as string },
        { variable: 'files2', type: InputVarType.multiFiles as string },
      ]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result.files1[0]).toHaveProperty('transfer_method', 'local_file')
      expect(result.files2[0]).toHaveProperty('processed', true)
    })

    it('processes jsonObject parsing correct json', () => {
      const inputs = {
        json1: '{"key": "value"}',
      }
      const inputsForm = [{ variable: 'json1', type: InputVarType.jsonObject as string }]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result.json1).toEqual({ key: 'value' })
    })

    it('processes jsonObject falling back to original if json is array or plain string/invalid json', () => {
      const inputs = {
        jsonInvalid: 'invalid json',
        jsonArray: '["a", "b"]',
        jsonPlainObj: { key: 'value' },
      }
      const inputsForm = [
        { variable: 'jsonInvalid', type: InputVarType.jsonObject as string },
        { variable: 'jsonArray', type: InputVarType.jsonObject as string },
        { variable: 'jsonPlainObj', type: InputVarType.jsonObject as string },
      ]
      const result = getProcessedInputs(inputs, inputsForm as InputForm[])
      expect(result.jsonInvalid).toBe('invalid json')
      expect(result.jsonArray).toBe('["a", "b"]')
      expect(result.jsonPlainObj).toEqual({ key: 'value' })
    })
  })
})
