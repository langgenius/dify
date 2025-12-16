import CryptoJS from 'crypto-js'
import { ENABLE_FIELD_ENCRYPTION, ENCRYPTION_KEY } from '@/config'

/**
 * Field Encryption Utilities
 * Provides AES-256-CBC encryption for sensitive fields (password, verification code)
 * during transmission from frontend to backend.
 *
 * Uses PBKDF2-HMAC-SHA256 for secure key derivation instead of legacy MD5.
 */

/**
 * Check if field encryption is enabled and properly configured
 * @returns true if encryption is enabled and key is available
 */
export function isEncryptionEnabled(): boolean {
  return ENABLE_FIELD_ENCRYPTION && !!ENCRYPTION_KEY
}

/**
 * Derive key and IV from passphrase using PBKDF2-HMAC-SHA256
 * @param passphrase - The encryption passphrase
 * @param salt - The salt (WordArray)
 * @returns Object with key and iv as WordArrays
 */
function deriveKeyAndIV(passphrase: string, salt: CryptoJS.lib.WordArray) {
  const iterations = 100000 // OWASP recommended minimum
  const keySize = 256 / 32 // 256 bits = 8 words (32 bits each)
  const ivSize = 128 / 32 // 128 bits = 4 words

    // Derive key and IV together using PBKDF2-HMAC-SHA256
  const derived = CryptoJS.PBKDF2(passphrase, salt, {
    keySize: keySize + ivSize, // Total 12 words = 48 bytes
    iterations,
    hasher: CryptoJS.algo.SHA256,
  })

    // Split into key and IV
  const derivedWords = derived.words
  const key = CryptoJS.lib.WordArray.create(derivedWords.slice(0, keySize))
  const iv = CryptoJS.lib.WordArray.create(derivedWords.slice(keySize, keySize + ivSize))

  return { key, iv }
}

/**
 * Encrypt sensitive field using AES-256-CBC with PBKDF2-HMAC-SHA256 key derivation
 * @param plaintext - The plain text to encrypt
 * @returns Encrypted text in base64 format compatible with backend, or original text if encryption is disabled
 */
export function encryptField(plaintext: string): string {
    // If encryption is disabled or key is missing, return plaintext
  if (!isEncryptionEnabled())
    return plaintext

  try {
        // Generate random 8-byte salt
    const salt = CryptoJS.lib.WordArray.random(8)

        // Derive key and IV using PBKDF2-HMAC-SHA256
    const { key, iv } = deriveKeyAndIV(ENCRYPTION_KEY, salt)

        // Encrypt using AES-256-CBC
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    })

        // Create format compatible with backend: "Salted__" + salt + ciphertext
    const ciphertext = encrypted.ciphertext
    const combined = CryptoJS.lib.WordArray.create()
      .concat(CryptoJS.enc.Latin1.parse('Salted__'))
      .concat(salt)
      .concat(ciphertext)

        // Return as base64
    return combined.toString(CryptoJS.enc.Base64)
  }
  catch (error) {
        // If encryption fails, we must not send the plaintext password.
        // Throw an error to abort the operation.
    console.error('Field encryption failed:', error)
    throw new Error('Encryption failed. Please check your configuration.')
  }
}

/**
 * Encrypt password field for login
 * @param password - Plain password
 * @returns Encrypted password or original if encryption disabled
 */
export function encryptPassword(password: string): string {
  return encryptField(password)
}

/**
 * Encrypt verification code for email code login
 * @param code - Plain verification code
 * @returns Encrypted code or original if encryption disabled
 */
export function encryptVerificationCode(code: string): string {
  return encryptField(code)
}
