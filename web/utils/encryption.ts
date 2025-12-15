import CryptoJS from 'crypto-js'
import { ENABLE_FIELD_ENCRYPTION, ENCRYPTION_KEY } from '@/config'

/**
 * Field Encryption Utilities
 * Provides AES-256-CBC encryption for sensitive fields (password, verification code)
 * during transmission from frontend to backend.
 */

/**
 * Check if field encryption is enabled and properly configured
 * @returns true if encryption is enabled and key is available
 */
export function isEncryptionEnabled(): boolean {
  return ENABLE_FIELD_ENCRYPTION && !!ENCRYPTION_KEY
}

/**
 * Encrypt sensitive field using AES-256-CBC
 * @param plaintext - The plain text to encrypt
 * @returns Encrypted text in base64 format, or original text if encryption is disabled
 */
export function encryptField(plaintext: string): string {
    // If encryption is disabled or key is missing, return plaintext
  if (!isEncryptionEnabled())
    return plaintext

  try {
        // Use CryptoJS.AES.encrypt which implements AES-256-CBC
        // The encryption key is automatically hashed to create a proper key
    const encrypted = CryptoJS.AES.encrypt(plaintext, ENCRYPTION_KEY)
    return encrypted.toString()
  }
  catch (error) {
        // If encryption fails, log error and return plaintext as fallback
    console.error('Field encryption failed:', error)
    return plaintext
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
