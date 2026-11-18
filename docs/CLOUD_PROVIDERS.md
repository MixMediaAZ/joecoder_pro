# DeepSeek and Replicate provider setup

Add credentials to the project's `.env`, or set environment variables in the
PowerShell session that starts JoeCoder. Keep your existing keys. Provider settings
load at startup; existing shell variables take precedence. Keys stay server-side.

```dotenv
DEEPSEEK_API_KEY=your-real-key
REPLICATE_API_TOKEN=your-real-token
JC_CLOUD_PROVIDER=deepseek
```

Use `JC_CLOUD_PROVIDER=replicate` to prefer Replicate, `anthropic` to prefer
Anthropic, or `auto` to retain existing routing priorities. This is a preference
among eligible providers, not authorization. Cloud work still requires a positive
authorized budget and an eligible privacy preset. Local Only never calls cloud.
Restart after changing settings: stop the current server, then run `start.bat`.
The launcher reuses an existing healthy instance, so launching it alone is not a
configuration reload.

| Provider | Credential | Supported models |
| --- | --- | --- |
| DeepSeek direct | `DEEPSEEK_API_KEY` | `deepseek-flash` (default); `deepseek-v4-pro` via `JC_DEEPSEEK_MODEL` |
| Replicate | `REPLICATE_API_TOKEN` | `deepseek-ai/deepseek-r1` |

The existing `REPLICATE_API_KEY` name is also accepted; API_TOKEN takes priority.
Placeholder keys do not enable these providers. Settings labels each configured
key **not verified**. A saved key does not prove billing credit or model access.

Both providers support chat, scope planning, and JoeCoder's validated JSON/file
edit protocol (the app's `tools` capability). They do not send images or native
API tool-call payloads. Replicate polls unfinished predictions, sets a server-side
cancellation deadline, and requests cancellation after a local timeout or stop.
R1's leading reasoning envelope is removed before parsing its final answer.
Token-limit finishes are rejected by structured validation. R1 requests are capped
at 32,768 output tokens and its remaining 65,536-token context. DeepSeek requests
are capped at 393,216 output tokens and the remaining 1,000,000-token context.

Budget checks use conservative UTF-8 input estimates and peak uncached prices.
Defaults in USD per million tokens:

| Model | Input | Output |
| --- | ---: | ---: |
| DeepSeek Flash | 0.30 | 1.20 |
| DeepSeek Pro | 1.32 | 3.96 |
| Replicate R1 | 3.75 | 10.00 |

Override updated rates with `JC_DEEPSEEK_INPUT_COST_PER_MILLION`,
`JC_DEEPSEEK_OUTPUT_COST_PER_MILLION`, `JC_REPLICATE_INPUT_COST_PER_MILLION`, or
`JC_REPLICATE_OUTPUT_COST_PER_MILLION`. Values must be positive finite numbers.
These estimates are not invoices; caching and off-peak discounts can reduce actual
charges. Reported token counts include reasoning where provided. Missing usage or
failed calls conservatively reserve the attempted output budget. Retries share the
remaining routed-turn budget or the same direct provider resolution's budget.
This is not an account-wide billing cap.

Optional `JC_DEEPSEEK_URL` and `JC_REPLICATE_URL` override API bases for trusted
gateways or testing. HTTPS is required, except for loopback test servers. Redirects
are rejected and Replicate's returned URLs are not trusted with credentials.

## Verification

Build, then run protocol/routing regression tests:

```powershell
npm run build
node --test dist/cloudProviders.test.js dist/providers.test.js dist/modelRouter.test.js
```

The default protocol suite uses Request/Response streams in-process and spends no
vendor credits. The same cases can use local HTTP servers for socket integration:

```powershell
$env:JC_TEST_HTTP_NETWORK='1'
node --test dist/cloudProviders.test.js
Remove-Item Env:JC_TEST_HTTP_NETWORK
```

The real HTTP mode needs permission to connect to loopback ports. Live vendor
generation additionally requires valid keys and account credit. No dependency was
added for either client.

API and pricing references, checked October 26, 2026:

- [DeepSeek chat API](https://api-docs.deepseek.com/api/create-chat-completion)
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Replicate HTTP API](https://replicate.com/docs/reference/http)
- [Replicate R1 schema](https://replicate.com/deepseek-ai/deepseek-r1/api/schema)
- [Replicate pricing](https://replicate.com/pricing)
