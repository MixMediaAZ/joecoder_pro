# Authenticated Local Session Contract

## Threat statement

Loopback is not trusted by itself. Other local processes and hostile browser content can attempt requests to the service.

## Binding

- Listen only on 127.0.0.1 by default.
- Use an OS-allocated port.
- Never bind to all interfaces through fallback.
- Validate Host against the allocated loopback authority.
- Serve UI and API from one origin.
- Preview/imported content uses a separate unprivileged origin and receives no session credential.

## Bootstrap flow

1. Orchestrator creates a cryptographically random 256-bit one-time bootstrap token in memory.
2. Launcher opens the UI with the token in the URL fragment.
3. Bootstrap script removes the fragment from history before other application work.
4. UI sends the token once to POST /api/v1/session/exchange.
5. Server atomically consumes the token.
6. Server sets an opaque HttpOnly, SameSite=Strict, host-only session cookie scoped to /api and returns a separate CSRF token in the response body.
7. UI holds the CSRF token in memory only and sends it through X-JC-CSRF for consequential requests.
8. Session, bootstrap token, and CSRF token are never placed in localStorage, sessionStorage, IndexedDB, logs, screenshots, traces, or error messages.

Secure cookie transport is enabled when local TLS is configured and its availability is reported. Plain loopback HTTP never permits non-loopback binding.

## Request checks

Every consequential request requires:

- valid session cookie;
- matching in-memory CSRF token;
- exact Origin;
- valid Host and port;
- accepted content type;
- body-size limit;
- idempotency key;
- expected project and Work Order versions where applicable;
- current capability returned by the deterministic state machine.

## Lifetime

- Bootstrap token: one use, maximum 60 seconds.
- Session idle timeout: 30 minutes.
- Session absolute lifetime: 8 hours.
- Authorization-grant expiration remains separate and can be shorter.
- Restart invalidates every bootstrap token, session, and CSRF token.

## Required routes

- POST /api/v1/session/exchange
- POST /api/v1/session/refresh
- POST /api/v1/session/logout
- GET /api/v1/session/status

Refresh requires an active valid session and rotates both session and CSRF values. Logout invalidates server state before responding.

## Mandatory negative tests

- missing, malformed, expired, consumed, and replayed bootstrap token;
- wrong Origin, Host, port, content type, or CSRF;
- browser storage inspection finds no credential;
- restart invalidates prior session;
- local process attempts direct consequential POST without session;
- imported preview attempts same-origin credential access;
- fragment and cookie values never appear in evidence or logs.

