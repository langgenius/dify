The vendored `sandbox/skill` is from ChromeDevTools/chrome-devtools-mcp,
commit b1e35e3ab1774664dfc66a2cb813a392535fe160 (chrome-devtools-mcp-v1.13.0).
Source: https://github.com/ChromeDevTools/chrome-devtools-mcp
The installed npm package is pinned to 1.13.0. See the accompanying upstream license.
`browser/seccomp.json` derives from Playwright's Linux seccomp profile, with the
three Landlock calls used by shellctl added. It does not disable Chrome sandbox.
