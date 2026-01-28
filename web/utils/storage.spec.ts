import { storage } from './storage'

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
    storage.resetCache()
  })

  describe('isAvailable', () => {
    it('should return true in jsdom environment', () => {
      expect(storage.isAvailable()).toBe(true)
    })

    it('should cache the availability result', () => {
      storage.isAvailable()
      const spy = vi.spyOn(Storage.prototype, 'setItem')
      storage.isAvailable()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('set and get', () => {
    it('should store and retrieve a string value', () => {
      storage.set('key', 'hello')
      expect(storage.get('key')).toBe('hello')
    })

    it('should store and retrieve a number value', () => {
      storage.set('key', 42)
      expect(storage.get('key')).toBe(42)
    })

    it('should store and retrieve a boolean value', () => {
      storage.set('key', true)
      expect(storage.get('key')).toBe(true)
    })

    it('should store and retrieve an object value', () => {
      storage.set('key', { a: 1, b: 'two' })
      expect(storage.get('key')).toEqual({ a: 1, b: 'two' })
    })

    it('should store and retrieve an array value', () => {
      storage.set('key', [1, 2, 3])
      expect(storage.get('key')).toEqual([1, 2, 3])
    })

    it('should store with versioned key prefix', () => {
      storage.set('mykey', 'val')
      expect(localStorage.getItem('v1:mykey')).toBe('val')
    })

    it('should return null for non-existent key', () => {
      expect(storage.get('missing')).toBeNull()
    })

    it('should return defaultValue for non-existent key', () => {
      expect(storage.get('missing', 'fallback')).toBe('fallback')
    })

    it('should silently fail when localStorage throws on setItem', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded')
      })
      expect(() => storage.set('key', 'val')).not.toThrow()
    })

    it('should return defaultValue when localStorage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('disabled')
      })
      storage.resetCache()

      expect(storage.get('key', 'fallback')).toBe('fallback')

      vi.restoreAllMocks()
    })
  })

  describe('remove', () => {
    it('should remove a stored key', () => {
      storage.set('key', 'val')
      storage.remove('key')
      expect(storage.get('key')).toBeNull()
    })

    it('should silently fail when localStorage throws on removeItem', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError')
      })
      expect(() => storage.remove('key')).not.toThrow()
    })
  })

  describe('getNumber', () => {
    it('should return a stored number', () => {
      storage.set('n', 3.14)
      expect(storage.getNumber('n')).toBe(3.14)
    })

    it('should parse a stored string as number', () => {
      storage.set('n', '42')
      expect(storage.getNumber('n')).toBe(42)
    })

    it('should return null for non-existent key without default', () => {
      expect(storage.getNumber('missing')).toBeNull()
    })

    it('should return defaultValue for non-existent key', () => {
      expect(storage.getNumber('missing', 100)).toBe(100)
    })

    it('should return defaultValue for non-numeric string', () => {
      storage.set('n', 'abc')
      expect(storage.getNumber('n', 0)).toBe(0)
    })

    it('should return null for non-numeric string without default', () => {
      storage.set('n', 'abc')
      expect(storage.getNumber('n')).toBeNull()
    })
  })

  describe('getBoolean', () => {
    it('should return a stored boolean true', () => {
      storage.set('b', true)
      expect(storage.getBoolean('b')).toBe(true)
    })

    it('should return a stored boolean false', () => {
      storage.set('b', false)
      expect(storage.getBoolean('b')).toBe(false)
    })

    it('should parse string "true" as true', () => {
      storage.set('b', 'true')
      expect(storage.getBoolean('b')).toBe(true)
    })

    it('should parse string "false" as false', () => {
      storage.set('b', 'false')
      expect(storage.getBoolean('b')).toBe(false)
    })

    it('should return null for non-existent key without default', () => {
      expect(storage.getBoolean('missing')).toBeNull()
    })

    it('should return defaultValue for non-existent key', () => {
      expect(storage.getBoolean('missing', true)).toBe(true)
    })
  })

  describe('resetCache', () => {
    it('should re-probe localStorage after reset', () => {
      expect(storage.isAvailable()).toBe(true)

      expect(storage.isAvailable()).toBe(true)

      storage.resetCache()

      expect(storage.isAvailable()).toBe(true)
    })
  })
})
