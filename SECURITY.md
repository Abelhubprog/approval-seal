# Security

approval-seal is a small hashing library. It has no network code, reads no files except those you pass the CLI, and has no dependencies.

## Reporting a problem

Use GitHub private vulnerability reporting (Security tab > Report a vulnerability). Do not post exploit details in a public issue. There is no bug bounty.

## What counts as a vulnerability here

- Two different actions that produce the same canonical JSON, or the same action hash.
- A record that verifies after its action, approver, timestamp, nonce, or expiry was changed, when the check was run with the stored seal.
- A way to consume the same (approver, nonce) twice through `claim()` with a correct store.
- Any difference between the Python and JavaScript canonical output for values inside the documented subset.

## What is out of scope

See "Threat model" in the README. In particular: this library does not authenticate the approver, does not sign anything, and does not protect a seal you did not store somewhere the attacker cannot write.

## Never put secrets in an action

The action is stored in the clear inside the sealed record. Do not put private keys, API keys, or session tokens in it.
