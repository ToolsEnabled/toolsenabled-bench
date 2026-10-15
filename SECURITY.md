# ToolsEnabled Bench security policy

ToolsEnabled Bench is the generic local benchmark builder, separate from Engine
Bench and Head Gasket Bench. This file combines its runtime boundaries with the
ToolsEnabled company security policy. Use the latest published release for
fixes. Consult the matching release verification record for tested hosts and
checks; native host qualification is separate.

## Report a problem privately

Email **[security@toolsenabled.ai](mailto:security@toolsenabled.ai)**. If this
repository's Security tab offers private vulnerability reporting, you can use
that instead. Do not put confidential reproductions or credentials in a public
issue. Include the Bench version (`package.json`), source commit or release
checksum when available, host/Node version, expected and observed behavior, and
a minimal reproduction with synthetic data. Never include your provenance key
or real provider credentials.

We read every report, reply as soon as we can, keep you informed while we fix
it, tell you when the fix is released, and credit you in the release notes if
you want that.

## Runtime boundaries

- The dashboard listens on `127.0.0.1` with exact Host/Origin checks and a
  per-process browser API token. It has no separate human login or one-time
  secret dashboard link. Do not expose it through a public proxy or assume
  loopback prevents other local processes from reaching it.
- MCP uses local stdio. Its host can read/write projects and exports and request
  execution. `study.run` and `study.qualify` require `confirm` equal to the exact
  study ID; studies without a valid store-local receipt also need `trust: true`.
  Host read-only annotations are hints. Confirmation and provenance checks do
  not isolate code from your account.
- Filesystem validation, revision checks, installed runtime admission and the
  single-owner data-root lease protect their stated operations. They are not
  defenses against hostile code running under the same OS user. Use one local
  filesystem/host/PID namespace per root; stop one interface before opening the
  same root with another. See [ownership and recovery](docs/MCP.md#data-root-ownership-and-recovery).
- **A received study's `cli.mjs` executes JavaScript and plugin imports before
  verification.** Start from an independently trusted Bench installation and use
  its CLI with `--project` pointing to the received data for `verify`, `status`,
  `analyze` or `reference`. These inspect retained evidence without executing
  received collectors, custom graders or archived runtime modules. Analysis and
  reference generation write derived files. Hashes prove consistency, not
  authorship or safety of the verifier itself.
- `qualify`, `run` and explicit `regrade` can execute declared code. Trusted
  build-time plugins also execute JavaScript. HTTP collectors send data to the
  declared endpoint; commands/modules/native tools have the current user's
  filesystem/network authority. Installed CLI children inherit the server's
  environment; command collectors then receive the base environment and declared
  variables. None of this provides an OS sandbox. Time/output bounds and
  cancellation do not prove arbitrary descendants are harmless or stopped.
- MCP output redaction is not storage encryption, export sanitization or a
  guarantee that every secret is detected. See [privacy and retention](PRIVACY.md)
  before using private data or sharing artifacts.

Inspect code and its destinations before authorizing execution. For studies you
cannot trust, use a separately secured environment whose permissions and network
policy you control. Do not use successful qualification, self-contained hashes,
or recorded diagnostic controls as a scientific validation claim.

## Good-faith research

Test on computers, accounts and projects that are yours or that you have
permission to use. Stop once you can demonstrate the problem. Do not access,
change or keep other people's data beyond what is needed to show it; delete
that data afterwards. Do not disrupt services or other people. Give us a
reasonable chance to fix the problem before publishing. We will not ask you to
stay silent indefinitely: if it is not fixed within 90 days of your report, you
may publish. If unsure whether research is covered, ask at the address above.

## Safe harbor

We want people to look for problems in ToolsEnabled Bench and will not treat
good-faith research as an attack. If you research and report in good faith under
this policy:

- We consider your research authorized and will not bring or support legal
  action against you for it, including under anti-hacking, anti-circumvention or
  similar laws.
- We waive any part of our own terms that would otherwise stop that research.
- If someone else takes legal action against you for research that followed
  this policy, we will make it known that your research was authorized by us.

This covers ToolsEnabled's own code and releases. It cannot grant permission
for another party's systems: report problems in agent clients, model providers
or other software we did not write to their makers.

ToolsEnabled is a small, self-funded company and does not pay report rewards.
We will credit you publicly if you want that. Bench is supplied "as is", without
warranty under the [MIT License](LICENSE). This policy explains how we handle
reports; it does not claim that any release is free of problems.
