# Security policy

This project handles credentials and sensitive tax evidence. Never open a public issue containing a username, password, tax identifier, verification digit, token, cookie, session URL, portal screenshot, HTML snapshot, or filing receipt.

## Reporting a vulnerability

Use the repository's private **Report a vulnerability** option under the Security tab when available. Include only the minimum reproduction steps and redact all credentials and tax data.

If a credential or token reaches Git, revoke or rotate it immediately. Deleting it in a later commit does not remove it from Git history.

## Boundaries

- Do not bypass CAPTCHA, MFA, or access controls.
- Do not test with an account you do not own or have authorization to use.
- Do not perform a real tax submission to reproduce a software issue.
- Use mocks for automated tests and dry-run mode for portal validation.
