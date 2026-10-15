# ToolsEnabled Bench: privacy and retention

These notes describe the local ToolsEnabled Bench 0.3.3 beta runtime. This is the
generic benchmark builder, separate from Engine Bench and Head Gasket Bench.
They do not describe your MCP client's, model provider's or backup service's
privacy practices.

## What stays on your machine

Bench stores editable projects and retained studies under the absolute directory
you select with `BENCHMARK_DATA_DIR` (the Claude plugin's `data_directory`
option). The dashboard and stdio MCP server use the same local storage model:

| Local material | Contents and purpose |
| --- | --- |
| `projects/` | Project names, timestamps, revisions, draft specifications, prompts and editor state; a replacement draft can retain an Undo snapshot. |
| `runs/` | Frozen protocol/runtime/attachments, run status and history, journals, raw responses, qualification and process receipts, generated reports and requested study ZIP exports. Failed/interrupted work can retain evidence too. |
| `.local-origin-key` | Private random key used to recognize this store's locally frozen studies. Back it up privately with the root; do not publish it or include it with shared studies. |
| `.bench-data-lease` and recovery guard | Process/host identity used to prevent simultaneous ownership of a data root. These are coordination records, not study evidence. |

The browser also keeps the Composition/Nesting Visualization-or-Data preference
in localStorage (`mc.research.<page>.view`). Clearing site data removes that
preference; it does not delete server-side projects/runs.

Files are ordinary local files, **not encrypted by Bench**. New private
folders/files request restrictive POSIX modes where supported; existing directory
permissions and Windows ACLs remain your responsibility. Use a private local
disk, OS access controls and your own encrypted backup if needed. Avoid a
network share or a folder automatically synchronized to a cloud service unless
you intend that service to receive the contents.

The prebuilt dashboard serves its own browser assets and uses local loopback
requests. The recorded arithmetic/structured-record controls replay authored
responses locally; they do not contact a model. No ToolsEnabled account is
required to use them. Bench does not automatically publish your study exports.

## When data leaves the process or machine

- **MCP clients:** stdio carries requested project data, tool inputs/results and
  report excerpts to the host running Bench. That host may retain conversations,
  logs or tool results and send them to its model provider. A local MCP server
  does not make the surrounding agent session local or private.
- **HTTP collectors:** an authorized study can POST its frozen request envelope
  to the configured endpoint. It can contain prompts, task/condition identifiers,
  study metadata and workflow context. If `credentialEnv` is declared, the CLI
  reads that environment variable and sends a Bearer authorization header to
  that endpoint; redirects are refused. Endpoint operators control their own
  retention, billing and onward processing.
- **Commands, modules and native apparatus:** collectors, qualification handlers,
  custom graders and trusted plugins can execute code with your user's
  filesystem/network authority. Commands receive their request on stdin, a base
  environment and explicitly declared environment/credential variables. This
  filtering is not an OS sandbox: code can read other files available to you or
  send data over the network. Review the code and declared destination first.
- **Distribution and tooling:** downloading releases/dependencies contacts their
  distributors; source builds use npm and optional browser/runtime downloads.
  Manually opening documentation links, emailing support, copying an export,
  or using your own sync/backup service sends data through those services.

## Secrets and redaction limits

Configure credentials by **environment variable name**, through your normal
private secret manager or host configuration. Do not paste values into prompts,
drafts, attachments, collector arguments or reports.

MCP responses redact known sensitive environment values, credential-shaped
fields and common secret formats before returning/paging reports. MCP process
logs omit child execution output. This is a best-effort output filter, not a
promise that all sensitive content is detected. It does **not** scrub the
original study files or ZIPs. The dashboard/CLI and retained raw transport or
process evidence can contain confidential prompts, responses, stdout/stderr and
other private data, including a credential echoed by a collector. Review the
complete bytes before sharing, not just a redacted MCP preview.

The Codex plugin manifest forwards `BENCHMARK_DATA_DIR` only. It does not forward
provider credentials from the parent shell. Direct MCP registrations can forward
explicitly configured variables; those values reach a collector only according
to its declaration and the host's environment. See [MCP setup](docs/MCP.md).

## Retention, deletion and backups

Bench keeps saved projects and study evidence in the selected root across server
restarts and plugin upgrades. There is no automatic study-retention deadline or
expiry service. Reports can be regenerated or replaced; journals and retained
responses support inspection and recovery. A single Undo snapshot is not a
backup of every draft revision.

To remove all local Bench data, stop every Bench client/server and its owned
work, then remove the selected data folder using your operating system. Retain a
private backup first if you need reproducibility or local provenance. Do not
remove a live lease file as a deletion shortcut. Removing an installation or
plugin cache does not remove your separately chosen data root. Likewise,
removing the root does not remove copies you exported, browser downloads/preferences,
client/provider conversation histories, backups or synced copies; manage those
with their respective tools and retention policies.

For privacy questions contact [support@toolsenabled.ai](mailto:support@toolsenabled.ai).
Report a suspected vulnerability privately using [SECURITY.md](SECURITY.md).
