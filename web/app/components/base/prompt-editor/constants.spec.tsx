import { SupportUploadFileTypes } from '../../workflow/types'
import {
  checkHasContextBlock,
  checkHasHistoryBlock,
  checkHasQueryBlock,
  checkHasRequestURLBlock,
  CONTEXT_PLACEHOLDER_TEXT,
  CURRENT_PLACEHOLDER_TEXT,
  ERROR_MESSAGE_PLACEHOLDER_TEXT,
  FILE_EXTS,
  getInputVars,
  HISTORY_PLACEHOLDER_TEXT,
  LAST_RUN_PLACEHOLDER_TEXT,
  PRE_PROMPT_PLACEHOLDER_TEXT,
  QUERY_PLACEHOLDER_TEXT,
  REQUEST_URL_PLACEHOLDER_TEXT,
  UPDATE_DATASETS_EVENT_EMITTER,
  UPDATE_HISTORY_EVENT_EMITTER,
} from './constants'

describe('prompt-editor constants', () => {
  describe('placeholder and event constants', () => {
    it('should expose expected placeholder constants', () => {
      expect(CONTEXT_PLACEHOLDER_TEXT).toBe('{{#context#}}')
      expect(HISTORY_PLACEHOLDER_TEXT).toBe('{{#histories#}}')
      expect(QUERY_PLACEHOLDER_TEXT).toBe('{{#query#}}')
      expect(REQUEST_URL_PLACEHOLDER_TEXT).toBe('{{#url#}}')
      expect(CURRENT_PLACEHOLDER_TEXT).toBe('{{#current#}}')
      expect(ERROR_MESSAGE_PLACEHOLDER_TEXT).toBe('{{#error_message#}}')
      expect(LAST_RUN_PLACEHOLDER_TEXT).toBe('{{#last_run#}}')
      expect(PRE_PROMPT_PLACEHOLDER_TEXT).toBe('{{#pre_prompt#}}')
    })

    it('should expose expected event emitter constants', () => {
      expect(UPDATE_DATASETS_EVENT_EMITTER).toBe('prompt-editor-context-block-update-datasets')
      expect(UPDATE_HISTORY_EVENT_EMITTER).toBe('prompt-editor-history-block-update-role')
    })
  })

  describe('check block helpers', () => {
    it('should detect context placeholder only when present', () => {
      expect(checkHasContextBlock('')).toBe(false)
      expect(checkHasContextBlock('plain text')).toBe(false)
      expect(checkHasContextBlock(`before ${CONTEXT_PLACEHOLDER_TEXT} after`)).toBe(true)
    })

    it('should detect history placeholder only when present', () => {
      expect(checkHasHistoryBlock('')).toBe(false)
      expect(checkHasHistoryBlock('plain text')).toBe(false)
      expect(checkHasHistoryBlock(`before ${HISTORY_PLACEHOLDER_TEXT} after`)).toBe(true)
    })

    it('should detect query placeholder only when present', () => {
      expect(checkHasQueryBlock('')).toBe(false)
      expect(checkHasQueryBlock('plain text')).toBe(false)
      expect(checkHasQueryBlock(`before ${QUERY_PLACEHOLDER_TEXT} after`)).toBe(true)
    })

    it('should detect request url placeholder only when present', () => {
      expect(checkHasRequestURLBlock('')).toBe(false)
      expect(checkHasRequestURLBlock('plain text')).toBe(false)
      expect(checkHasRequestURLBlock(`before ${REQUEST_URL_PLACEHOLDER_TEXT} after`)).toBe(true)
    })
  })

  describe('getInputVars', () => {
    it('should return empty array for invalid or empty input', () => {
      expect(getInputVars('')).toEqual([])
      expect(getInputVars('plain text without vars')).toEqual([])
      expect(getInputVars(null as unknown as string)).toEqual([])
    })

    it('should ignore placeholders that are not input vars', () => {
      const text = `a ${CONTEXT_PLACEHOLDER_TEXT} b ${QUERY_PLACEHOLDER_TEXT} c`

      expect(getInputVars(text)).toEqual([])
    })

    it('should parse regular input vars with dotted selectors', () => {
      const text = 'value {{#node123.result.answer#}} and {{#abc.def#}}'

      expect(getInputVars(text)).toEqual([
        ['node123', 'result', 'answer'],
        ['abc', 'def'],
      ])
    })

    it('should strip numeric node id for sys selector vars', () => {
      const text = 'value {{#1711617514996.sys.query#}}'

      expect(getInputVars(text)).toEqual([
        ['sys', 'query'],
      ])
    })

    it('should keep selector unchanged when sys prefix is not numeric id', () => {
      const text = 'value {{#abc.sys.query#}}'

      expect(getInputVars(text)).toEqual([
        ['abc', 'sys', 'query'],
      ])
    })
  })

  describe('file extension map', () => {
    it('should expose expected file extensions for each supported type', () => {
      expect(FILE_EXTS[SupportUploadFileTypes.image]).toContain('PNG')
      expect(FILE_EXTS[SupportUploadFileTypes.document]).toContain('PDF')
      expect(FILE_EXTS[SupportUploadFileTypes.audio]).toContain('MP3')
      expect(FILE_EXTS[SupportUploadFileTypes.video]).toContain('MP4')
    })
  })
})
