# Online-drive remote metadata contract

This document defines the optional wire extension shared by datasource plugins, Dify API, and
KnowledgeFS when checking whether an online-drive file changed. It is an optimization contract,
not a requirement for invoking an existing plugin.

## Wire locations

- Browse: `OnlineDriveBrowseFilesResponse.result[].files[].remote_metadata`.
- Download: every `blob` or `blob_chunk` message may carry
  `meta.remote_metadata`. Chunked downloads establish a receipt only when every chunk belongs to
  one complete stream and carries identical metadata.

```json
{
  "remote_metadata": {
    "version_id": "opaque-provider-version",
    "etag": "\"opaque-provider-etag\"",
    "checksum": {
      "algorithm": "sha256",
      "value": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    "modified_time": "2026-09-09T00:00:00Z"
  }
}
```

All members are optional. Producers must omit unsupported members; they must not synthesize a
version, reinterpret an ETag as an MD5 digest, or include credentials, signed URLs, headers, or
arbitrary provider metadata.

## Field rules

| Field | Wire rule | Change-detection rule |
| --- | --- | --- |
| `version_id` | Non-empty opaque printable string, at most 1024 characters. The sentinel `"null"` is ignored. | Reliable only after the same value was attested by a successful download response. |
| `etag` | Non-empty opaque printable string, at most 1024 characters. Weak ETags (`W/`) are ignored. | Reliable only after the same value was attested by a successful download response. It is never treated as a checksum. |
| `checksum` | Full-file `md5` (32 hex characters) or `sha256` (64 hex characters). Hex is case-insensitive on the wire and normalized to lowercase. | A matching SHA-256 can skip a download directly. MD5 requires a matching published-file verification baseline. A download-response mismatch rejects the bytes before publication. |
| `modified_time` | Valid ISO-8601 timestamp with a timezone, at most 64 characters. | Advisory only. Modification time and size, even together, never skip a download. |

Malformed fields are ignored independently. If no usable field remains, Dify and KnowledgeFS
behave exactly as they do for a legacy plugin: download the source and compare its SHA-256 content
hash.

## Baseline and failure semantics

KnowledgeFS binds version and ETag shortcuts only to metadata returned with the downloaded bytes.
A browse-time marker alone must never establish the baseline. The baseline is scoped to the source
and connection identity and to the currently published content hash.

When downloaded content changed, KnowledgeFS materializes and publishes the new revision before
recording its verification baseline. Failed materialization, failed publication, checksum
mismatch, a stale source identity, or a concurrent content change must not advance the baseline.

