import { BlockClassificationEnum } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../gen-node-meta-data'

describe('genNodeMetaData', () => {
  it('should generate metadata with all required fields', () => {
    const result = genNodeMetaData({
      sort: 1,
      type: BlockEnum.LLM,
      title: 'LLM Node',
    })

    expect(result).toEqual({
      classification: BlockClassificationEnum.Default,
      sort: 1,
      type: BlockEnum.LLM,
      title: 'LLM Node',
      author: 'Dify',
      helpLinkUri: BlockEnum.LLM,
      isRequired: false,
      isUndeletable: false,
      isStart: false,
      isSingleton: false,
      isTypeFixed: false,
    })
  })

  it('should use custom values when provided', () => {
    const result = genNodeMetaData({
      classification: BlockClassificationEnum.Logic,
      sort: 5,
      type: BlockEnum.Start,
      title: 'Start',
      author: 'Custom',
      helpLinkUri: 'code',
      isRequired: true,
      isUndeletable: true,
      isStart: true,
      isSingleton: true,
      isTypeFixed: true,
    })

    expect(result.classification).toBe(BlockClassificationEnum.Logic)
    expect(result.author).toBe('Custom')
    expect(result.helpLinkUri).toBe('code')
    expect(result.isRequired).toBe(true)
    expect(result.isUndeletable).toBe(true)
    expect(result.isStart).toBe(true)
    expect(result.isSingleton).toBe(true)
    expect(result.isTypeFixed).toBe(true)
  })

  it('should default title to empty string', () => {
    const result = genNodeMetaData({
      sort: 0,
      type: BlockEnum.Code,
    })

    expect(result.title).toBe('')
  })

  it('should fall back helpLinkUri to type when not provided', () => {
    const result = genNodeMetaData({
      sort: 0,
      type: BlockEnum.HttpRequest,
    })

    expect(result.helpLinkUri).toBe(BlockEnum.HttpRequest)
  })
})
