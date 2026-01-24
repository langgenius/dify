Summary:
Summary:
- Builds skill artifacts from markdown assets and uploads resolved outputs.

Invariants:
- Reads draft asset content via AppAssetStorage refs.
- Writes resolved artifacts via AppAssetStorage refs.
- FileAsset storage keys are derived via AppAssetStorage.

Edge Cases:
- Missing or invalid JSON content yields empty skill content/metadata.

Tests:
- Build pipeline unit tests covering compile/upload paths.
