import type { InputForm } from '../type'
import { InputVarType } from '@/app/components/workflow/types'
import { getProcessedInputs, processInputFileFromServer, processOpeningStatement } from '../utils'

const inputForm = (variable: string, type: InputVarType, label = variable): InputForm => ({
  variable,
  type,
  label,
  required: false,
  hide: false,
})

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
      const result = processOpeningStatement('Hello {{user_name}}', {}, [
        inputForm('user_name', InputVarType.textInput, 'Name Label'),
      ])
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
        inputForm('terms', InputVarType.checkbox),
        inputForm('conds', InputVarType.checkbox),
      ]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result).toEqual({ terms: true, conds: false })
    })

    it('ignores null values', () => {
      const inputs = { test: null }
      const inputsForm = [inputForm('test', InputVarType.textInput)]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result).toEqual({ test: null })
    })

    it('processes singleFile using transfer_method logic', () => {
      const inputs = {
        file1: {
          type: 'document',
          transfer_method: 'local_file',
          remote_url: 'https://example.com/report.pdf',
          related_id: 'server-1',
        },
        file2: {
          id: 'file2',
          uploadedId: 'upload-2',
          progress: 100,
          supportFileType: 'document',
          transferMethod: 'local_file',
        },
      }
      const inputsForm = [
        inputForm('file1', InputVarType.singleFile),
        inputForm('file2', InputVarType.singleFile),
      ]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result.file1).toEqual({
        type: 'document',
        transfer_method: 'local_file',
        url: 'https://example.com/report.pdf',
        upload_file_id: 'server-1',
      })
      expect(result.file2).toEqual({
        type: 'document',
        transfer_method: 'local_file',
        url: '',
        upload_file_id: 'upload-2',
      })
    })

    it('processes multiFiles using transfer_method logic', () => {
      const inputs = {
        files1: [
          {
            type: 'document',
            transfer_method: 'local_file',
            remote_url: 'https://example.com/report.pdf',
            related_id: 'server-1',
          },
        ],
        files2: [
          {
            id: 'file2',
            uploadedId: 'upload-2',
            progress: 100,
            supportFileType: 'document',
            transferMethod: 'local_file',
          },
        ],
      }
      const inputsForm = [
        inputForm('files1', InputVarType.multiFiles),
        inputForm('files2', InputVarType.multiFiles),
      ]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result.files1).toEqual([
        {
          type: 'document',
          transfer_method: 'local_file',
          url: 'https://example.com/report.pdf',
          upload_file_id: 'server-1',
        },
      ])
      expect(result.files2[0]).toEqual({
        type: 'document',
        transfer_method: 'local_file',
        url: '',
        upload_file_id: 'upload-2',
      })
    })

    it('processes jsonObject parsing correct json', () => {
      const inputs = {
        json1: '{"key": "value"}',
      }
      const inputsForm = [inputForm('json1', InputVarType.jsonObject)]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result.json1).toEqual({ key: 'value' })
    })

    it('processes jsonObject falling back to original if json is array or plain string/invalid json', () => {
      const inputs = {
        jsonInvalid: 'invalid json',
        jsonArray: '["a", "b"]',
        jsonPlainObj: { key: 'value' },
      }
      const inputsForm = [
        inputForm('jsonInvalid', InputVarType.jsonObject),
        inputForm('jsonArray', InputVarType.jsonObject),
        inputForm('jsonPlainObj', InputVarType.jsonObject),
      ]
      const result = getProcessedInputs(inputs, inputsForm)
      expect(result.jsonInvalid).toBe('invalid json')
      expect(result.jsonArray).toBe('["a", "b"]')
      expect(result.jsonPlainObj).toEqual({ key: 'value' })
    })
  })
})
