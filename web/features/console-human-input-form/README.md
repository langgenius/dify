# Console Human Input Form

`/human-input/[formToken]` is the standalone, signed-in Console approval page.
It reuses the Console authentication boundary and the existing standalone form
presentation. Login redirects preserve the form URL. The backend remains the
authority for workspace access and recipient eligibility.

- `form.tsx` owns fetching, submission, expiry, and completion/error states.
- `definition.ts` validates the generated record response using existing field
  and action schemas, then maps rendered content and resolved defaults.
- `links.ts` maps legacy backstage links from Console pause details to this page.
  Public V2 and unrelated links are left unchanged.

The existing `/console/api/form/human_input/{form_token}` endpoint accepts legacy
Console/backstage tokens. Submission reuses the working workflow service because
the generated submit contract still requires an obsolete `form_inputs` property.
No generated contracts or backend code are modified here.

V2 tokens require a separate Console backend contract and are not routed through
this legacy adapter. Public `/form/[token]` and `/form-v2/[token]` pages keep their
existing behavior. The route parameter is deliberately `formToken`: shared file
upload code uses `params.token` to select public uploads, while this page must use
authenticated Console uploads.
