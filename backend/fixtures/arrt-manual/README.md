# ARRT manual sample fixtures

This directory is used only by `npm run test:arrt:manual`.

- Fixture saving is off by default.
- It requires `--save-fixture`, `--fixture-authorized` and a final typed
  confirmation.
- Only the sanitized response fragment is written. Scripts, styles, frames,
  form controls, event handlers, data attributes and token-like attributes are
  removed first.
- The table content can still contain personal data. Store, copy and share
  these files only when the ARRT authorization and the organization's
  data-handling rules permit it.
- Do not commit captured fixtures to source control unless that has been
  explicitly approved.
