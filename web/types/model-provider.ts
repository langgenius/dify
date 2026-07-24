/**
 * Model provider quota types - shared type definitions for API responses
 * These represent the provider identifiers that support paid/trial quotas
 */
export enum ModelProviderQuotaGetPaid {
  ANTHROPIC = 'langgenius/anthropic/anthropic',
  OPENAI = 'langgenius/openai/openai',
  // AZURE_OPENAI = 'langgenius/azure_openai/azure_openai',
  GEMINI = 'langgenius/gemini/google',
  X = 'langgenius/x/x',
  DEEPSEEK = 'langgenius/deepseek/deepseek',
  TONGYI = 'langgenius/tongyi/tongyi',
}
