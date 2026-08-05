# Configuration and Security-Policy Contract

## Core rule

Configuration selects values. Policy grants or denies capability. Configuration can never create authority.

## Restrictive capability lattice

Effective capability is the intersection of:

1. Constitution and canonical laws.
2. Frozen system security policy.
3. Project policy.
4. Current Work Order grant.
5. Actually measured host/provider/isolation capability.

The most restrictive result wins. Missing, malformed, expired, revoked, or unverifiable input denies the capability.

Examples:

- A Work Order cannot enable cloud use when project policy is local-only.
- An environment variable cannot grant network access.
- A selected model cannot grant itself tools.
- Administrator status does not bypass path, evidence, or completion policy.
- A requested strong-isolation operation is unavailable when the measured profile is weaker.

## Value resolution

For non-security values explicitly marked overrideable:

1. Immutable approved Work Order value.
2. Process environment or development .env.
3. Project configuration.
4. User configuration.
5. Built-in default.

Each resolved value records key, redacted value state, source, source location, validation result, dynamic/restart behavior, and policy constraints.

Security-sensitive values are not resolved by precedence. They are evaluated through the capability lattice.

## Secret resolution

Normal operation:

1. Windows Credential Manager reference.
2. Provider-specific interactive configuration that stores into Credential Manager.

Development-only operation:

1. Process environment.
2. .env loaded from the JoeCoder development root.

Secrets are never accepted from project repositories, browser storage, query strings, logs, evidence summaries, model prompts, or user configuration JSON.

The status API returns present, absent, invalid, inaccessible, or development-only—never plaintext.

## Development .env behavior

- Loading is explicit and only in development mode.
- .env.example is the complete documented key inventory.
- Unknown JC-prefixed keys fail validation.
- Duplicate/conflicting keys fail with provenance.
- Empty optional provider keys mean unconfigured.
- Relative paths are resolved against the declared development root and canonicalized.
- OLLAMA_BASE_URL defaults to loopback. A non-loopback URL requires explicit remote-provider policy and Work Order authorization.
- Cloud keys do not imply cloud permission.
- JC_NETWORK_DEFAULT describes requested policy, not proven enforcement.

## Canonical initial defaults

| Key | Default | Classification |
|---|---:|---|
| JC_HOST | 127.0.0.1 | security constrained; loopback only |
| JC_PORT | 0 | non-secret value |
| JC_LOG_LEVEL | info | non-secret value |
| JC_TELEMETRY_ENABLED | false | privacy constrained |
| OLLAMA_BASE_URL | http://127.0.0.1:11434 | provider endpoint; loopback default |
| JC_COMMAND_TIMEOUT_MS | 120000 | budget default |
| JC_MAX_PROCESS_MEMORY_MB | 4096 | budget default |
| JC_MAX_PROCESS_COUNT | 32 | budget default |
| JC_NETWORK_DEFAULT | deny | policy request; enforcement separately attested |

## Failure behavior

- Invalid required value: startup fails with stable configuration code.
- Invalid optional capability: capability disabled and reported unavailable.
- Security-policy conflict: deny and expose the conflicting sources.
- Secret-store failure: provider unavailable; no fallback to plaintext persistence.
- Redaction failure: cancel the operation and open a P0 evidence incident.

