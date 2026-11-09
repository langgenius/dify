# Managed Graphon source

This directory vendors `langgenius/graphon` at
`4fa22141774dff80e90e4dfa98ea3e6fbf0421bb` (version 0.8.0), under Apache-2.0.
The original LICENSE and package metadata are preserved. No virtual environment
or cache is copied. Dify's uv source points to this source directory so a clean
clone, CI and image build install the same reviewed implementation.

Local framework patch:

- `src/graphon/entities/pause_reason.py`: add the generic, identity-only
  `ExternalWaitReason` to the typed pause union. Existing node events, graph
  events and runtime snapshots validate this real reason through the same union.
- `tests/test_external_wait.py`: reason and snapshot round-trip/compatibility.
- `src/graphon/entities/base_node_data.py`: support Boolean and Array[Boolean]
  default values in the generic node contract. Scalar booleans remain strict;
  existing default types retain their historical behavior. Host-specific strict
  validation still runs before this compatibility DTO.
- `tests/test_external_wait.py`: Boolean default round trips and rejection of
  scalar string coercion, alongside unchanged legacy Number conversion.

The patch contains no Dify tenant, authentication, transport or timeout policy.
The host persists external work and re-reads its result on resumption. Upstream
updates must rebase this explicit patch and rerun snapshot compatibility tests.

This managed source is deliberately reviewable in the single Dify change;
there are no runtime model substitutions or environment-installed patches.
