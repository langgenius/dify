# ADR 0006: Preserve utility formatting edge cases

Status: Accepted (existing behavior)
Date: 2026-11-23
Owners: `web/utils/format.ts`, `web/utils/error-parser.ts`

## Context

Default string conversions can hide small numeric values in exponent notation. Hidden filenames and nested plugin-error envelopes also need behavior beyond their function names.

## Decision

For nonzero numbers with absolute value below 0.001, calculate fixed-point precision from the exponent plus the mantissa's decimal digits, or use the existing decimal precision when no exponent exists. Preserve readable small values such as 0.0000008. Comma grouping applies to the integer portion.

When extracting an extension, disregard a leading dot: `.gitignore` has no extension, `.hidden.txt` has `txt`, and `archive.tar.gz` has `gz`.

The `PluginInvokeError` JSON extraction uses a greedy brace match so nested objects remain intact before JSON parsing. Preserve the fallback to the raw message when parsing fails. This records the existing envelope assumption, not a claim that arbitrary multiple JSON envelopes are supported.

## Consequences

Simplifying formatting or error extraction requires checking these observable cases. Existing format examples that only repeated obvious operations were removed with the rest of the tautological prose.
