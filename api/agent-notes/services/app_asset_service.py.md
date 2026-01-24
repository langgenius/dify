Summary:
- App asset CRUD, publish/build pipeline, and presigned URL generation.

Invariants:
- Asset storage access goes through AppAssetStorage + AssetPath, using app_asset_storage singleton.
- Tree operations require tenant/app scoping and lock for mutation.
- Asset zips are packaged via raw storage with storage keys from AppAssetStorage.

Edge Cases:
- File nodes larger than preview limit are rejected.
- Deletion runs asynchronously; storage failures are logged.

Tests:
- Unit tests for storage URL generation and publish/build flows.
