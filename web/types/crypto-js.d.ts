declare module 'crypto-js' {
  export type CipherHelper = {
    encrypt: (message: string, key: string) => CipherParams
    decrypt: (ciphertext: CipherParams | string, key: string) => DecryptedMessage
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

  export type Encoder = {
    parse: (str: string) => WordArray
    stringify: (wordArray: WordArray) => string
  }

  export type WordArray = {
    words: number[]
    sigBytes: number
    toString: (encoder?: Encoder) => string
  }

  export const AES: CipherHelper
  export const enc: {
    Utf8: Encoder
    Hex: Encoder
    Latin1: Encoder
    Base64: Encoder
  }
}
