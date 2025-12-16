declare module 'crypto-js' {
  export namespace lib {
    export type WordArray = {
      words: number[]
      sigBytes: number
      toString: (encoder?: Encoder) => string
      concat: (wordArray: WordArray) => WordArray
      create: (words?: number[], sigBytes?: number) => WordArray
    }

    export const WordArray: {
      create: (words?: number[], sigBytes?: number) => WordArray
      random: (nBytes: number) => WordArray
    }
  }

  export type WordArray = lib.WordArray

  export type Encoder = {
    parse: (str: string) => WordArray
    stringify: (wordArray: WordArray) => string
  }

  export type CipherParams = {
    toString: () => string
    ciphertext: WordArray
    key: WordArray
    iv: WordArray
    salt: WordArray
  }

  export type DecryptedMessage = {
    toString: (encoder?: Encoder) => string
  }

  export type CipherHelper = {
    encrypt: (message: string, key: WordArray | string, cfg?: CipherConfig) => CipherParams
    decrypt: (ciphertext: CipherParams | string, key: WordArray | string, cfg?: CipherConfig) => DecryptedMessage
  }

  export type CipherConfig = {
    iv?: WordArray
    mode?: Mode
    padding?: Padding
  }

  export type Mode = {
    CBC: Mode
  }

  export type Padding = {
    Pkcs7: Padding
  }

  export type HasherHelper = {
    SHA256: HasherHelper
  }

  export const AES: CipherHelper
  export const PBKDF2: (
    password: string,
    salt: WordArray,
    cfg?: { keySize?: number; iterations?: number; hasher?: HasherHelper },
  ) => WordArray

  export const mode: {
    CBC: Mode
  }

  export const pad: {
    Pkcs7: Padding
  }

  export const algo: {
    SHA256: HasherHelper
  }

  export const enc: {
    Utf8: Encoder
    Hex: Encoder
    Latin1: Encoder
    Base64: Encoder
  }
}
