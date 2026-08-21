# Dify Pysa security models

The models in this directory define Dify's Python source-to-sink security
analysis. Run them from `api/` with:

```bash
PYREFLY_CONFIG=pyrefly.pysa.toml uv run pyre analyze --verify-dsl
```

The analysis covers:

- Flask request bodies, query parameters, files, headers, cookies, URL
  metadata, and scalar Flask-RESTX route parameters.
- Responses from Dify's SSRF client, remote file fetcher, custom API tools,
  plugin daemon, and MCP clients.
- Code and command execution, dynamic imports, unsafe deserialization, raw SQL,
  outbound URLs, filesystem access, unescaped responses, redirects, and
  server-side template compilation.

Third-party implementations remain opaque for performance. The stubs under
`stubs/` expose only security-relevant framework and client interfaces, while
the `.pysa` files model Dify-owned trust boundaries and selected standard or
third-party APIs. Add a stub and a model whenever a new opaque boundary can
introduce external data or consume security-sensitive input.

Every rule has a positive and negative fixture. Run the regression suite with:

```bash
uv run pytest -q tests/unit_tests/security/test_pysa_models.py
```

Pysa findings are candidates for review, not confirmed vulnerabilities. In
particular, SSRF findings at `core.helper.ssrf_proxy` identify user-selected
destinations even though the runtime proxy remains the enforcement layer.

## Reading the analysis output

Save the full result when the output needs to be inspected or retained:

```bash
PYREFLY_CONFIG=pyrefly.pysa.toml uv run pyre analyze \
  --verify-dsl \
  --save-results-to security/pysa/results
```

The generated `security/pysa/results/taint-output.json` is JSON Lines: every
line is an independent JSON object. The first line contains file metadata,
`kind: "model"` records describe Pysa's internal callable models, and
`kind: "issue"` records are the candidate data flows that require review.
Normally, reviewers should filter out the model records:

```bash
jq -r '
  select(.kind == "issue")
  | [
      .data.code,
      .data.filename,
      .data.line,
      .data.callable,
      .data.message
    ]
  | @tsv
' security/pysa/results/taint-output.json \
  | column -t -s $'\t' \
  | less -S
```

An issue record contains these important fields:

- `code`: the rule identifier from `taint.config`.
- `filename`, `line`, `start`, and `end`: the reported source location.
- `callable`: the function or method containing the reported flow.
- `message`: the source and sink categories connected by the flow.
- `traces`: the evidence Pysa used to connect the source to the sink.
- `features`: operations observed during propagation, such as field access,
  formatting, or an opaque call.
- `master_handle`: a stable finding identifier suitable for deduplication or a
  baseline.

The configured rules are:

| Code | Candidate issue |
| ---: | --- |
| 5001 | Untrusted data reaching code execution |
| 5005 | SQL injection |
| 5008 | Cross-site scripting |
| 5011 | Arbitrary filesystem access |
| 5012 | Server-side request forgery |
| 5018 | Open redirect |
| 6064 | Dynamic import injection |
| 6065 | Command injection |
| 6066 | Unsafe deserialization |
| 6073 | Server-side template injection |

In `traces`, the `forward` trace leads back to the source and the `backward`
trace leads toward the sink. Inspect the `leaves` entries in each direction to
identify the modeled API at the end of that trace. The intermediate `call`
entries show the call sites through which the value propagated.

For example, the following abbreviated issue is representative of the JSON
shape produced by a scan:

```json
{
  "kind": "issue",
  "data": {
    "callable": "commands.plugin.transform_datasource_credentials",
    "code": 5012,
    "filename": "commands/plugin.py",
    "line": 350,
    "start": 82,
    "end": 107,
    "message": "Data from [DataFromInternet] may reach [HTTPClientRequest]",
    "traces": [
      {
        "name": "forward",
        "roots": [
          {
            "kinds": [
              {
                "kind": "DataFromInternet",
                "leaves": [
                  {"name": "httpx.post", "port": "leaf:return"}
                ]
              }
            ],
            "call": {
              "resolves_to": [
                "services.plugin.plugin_migration.PluginMigration._fetch_latest_package_identifier"
              ],
              "port": "result"
            }
          }
        ]
      },
      {
        "name": "backward",
        "roots": [
          {
            "kinds": [
              {
                "kind": "HTTPClientRequest",
                "leaves": [
                  {
                    "name": "core.helper.ssrf_proxy.make_request",
                    "port": "leaf:url"
                  }
                ]
              }
            ],
            "call": {
              "position": {"line": 350, "start": 82, "end": 107},
              "port": "formal(plugin_unique_identifiers, position=1)[*]"
            }
          }
        ]
      }
    ],
    "features": [
      {"first-field": "latest_package_identifier"},
      {"always-via": "format-string"},
      {"always-via": "tito"}
    ],
    "master_handle": "commands.plugin.transform_datasource_credentials:5012:..."
  }
}
```

Read this example as follows:

1. Rule `5012` classifies the candidate as SSRF.
2. The forward leaf says the original `DataFromInternet` value came from the
   return value of `httpx.post`.
3. The value propagated through
   `PluginMigration._fetch_latest_package_identifier` and the
   `latest_package_identifier` field.
4. The backward leaf says the value may eventually reach the `url` parameter
   of `core.helper.ssrf_proxy.make_request`.
5. `commands/plugin.py:350` is the reported call site to inspect first.
6. The `tito` feature means taint-in-taint-out propagation was summarized
   through at least one call; it is not proof that every intermediate value is
   attacker-controlled.

The trace therefore means that data received from an external service may
later select an outbound URL. It is a review candidate, not proof of an
exploitable SSRF: the proxy may validate the URL, reject private addresses,
and constrain redirects at runtime.

Useful queries include:

```bash
# Show one rule category.
jq 'select(.kind == "issue" and .data.code == 5005)' \
  security/pysa/results/taint-output.json

# Show one finding at a known location.
jq '
  select(
    .kind == "issue"
    and .data.filename == "commands/plugin.py"
    and .data.line == 350
  )
' security/pysa/results/taint-output.json

# Count findings by rule.
jq -s '
  map(select(.kind == "issue") | .data)
  | group_by(.code)
  | map({code: .[0].code, count: length})
' security/pysa/results/taint-output.json
```

Review a finding in this order:

1. Open `filename:line` and identify the operation that raised the finding.
2. Follow the backward trace to verify that the final sink is security
   sensitive in this context.
3. Follow the forward trace to verify that an attacker or external system can
   control the original value.
4. Inspect the intervening code for validation, escaping, parameterization,
   authorization, or other enforcement that is not represented in the model.
5. Treat `obscure:model`, `obscure:unknown-callee`, and `tito` features as a
   reason for additional manual review because they indicate summarized or
   incomplete call behavior.
6. Classify the result as exploitable, safely constrained, or a modeling false
   positive. A rule with zero findings means only that no modeled flow was
   proven; it does not prove that the vulnerability class is absent.
