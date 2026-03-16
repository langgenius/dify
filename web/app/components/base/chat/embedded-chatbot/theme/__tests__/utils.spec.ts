import { CssTransform, hexToRGBA } from '../utils'

describe('Theme Utils', () => {
  describe('hexToRGBA', () => {
    it('should convert hex with # to rgba', () => {
      expect(hexToRGBA('#000000', 1)).toBe('rgba(0,0,0,1)')
      expect(hexToRGBA('#FFFFFF', 0.5)).toBe('rgba(255,255,255,0.5)')
      expect(hexToRGBA('#FF0000', 0.1)).toBe('rgba(255,0,0,0.1)')
    })

    it('should convert hex without # to rgba', () => {
      expect(hexToRGBA('000000', 1)).toBe('rgba(0,0,0,1)')
      expect(hexToRGBA('FFFFFF', 0.5)).toBe('rgba(255,255,255,0.5)')
    })

    it('should handle various opacity values', () => {
      expect(hexToRGBA('#000000', 0)).toBe('rgba(0,0,0,0)')
      expect(hexToRGBA('#000000', 1)).toBe('rgba(0,0,0,1)')
    })
  })

  describe('CssTransform', () => {
    it('should return empty object for empty string', () => {
      expect(CssTransform('')).toEqual({})
    })

    it('should transform single property', () => {
      expect(CssTransform('color: red')).toEqual({ color: 'red' })
    })

    it('should transform multiple properties', () => {
      expect(CssTransform('color: red; margin: 10px')).toEqual({
        color: 'red',
        margin: '10px',
      })
    })

    it('should handle extra whitespace', () => {
      expect(CssTransform('  color :  red ;  margin : 10px   ')).toEqual({
        color: 'red',
        margin: '10px',
      })
    })

    it('should handle trailing semicolon', () => {
      expect(CssTransform('color: red;')).toEqual({ color: 'red' })
    })

    it('should ignore empty pairs', () => {
      expect(CssTransform('color: red;; margin: 10px; ')).toEqual({
        color: 'red',
        margin: '10px',
      })
    })
  })
})
