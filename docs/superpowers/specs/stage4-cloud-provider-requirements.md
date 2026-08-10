# Stage 4: Cloud Provider Configuration Requirements

**Stage Number:** 4
**Date:** 2026-08-09
**Status:** BLOCKED - Operator Action Required

## Blocker Description

Two live providers not configured → Stage 4 BLOCKED until operator provides second eligible live cloud provider.

**Current Configuration:**
- Provider 1: Anthropic (Claude 3.5 Sonnet, Claude 3.5 Haiku)
- Provider 2: Not configured

## Requirements

1. **Second Cloud Provider:** Operator must select and configure second eligible live cloud provider
2. **Provider Credentials:** Credentials securely stored (e.g., API keys)
3. **Provider Documentation:** Provider details and reasoning preserved
4. **Dual-Provider Routing:** System must route to primary and secondary providers

## Recommended Providers

Based on existing codebase, eligible providers include:
- OpenRouter
- Together.ai
- Anyscale
- Modal
- Other Anthropic-compatible providers

## Implementation Steps

1. Operator selects second cloud provider
2. Operator configures provider credentials in `.env` or system
3. Operator documents provider details and reasoning in this file
4. Operator runs Stage 4 qualification with both providers

## Success Criteria

- ✅ Second cloud provider configured
- ✅ Provider credentials securely stored
- ✅ Provider documentation preserved
- ✅ Stage 4 qualification passes
- ✅ Failure and recovery verified
- ✅ Evidence preserved in signed manifest

## Example Provider Documentation

```markdown
### Provider: [Provider Name]

**Provider Type:** [e.g., Anthropic-compatible / OpenAI-compatible]

**Provider URL:** [provider website]

**API Endpoint:** [e.g., https://api.anthropic.com]

**Credentials:** [anthropic_key or provider-specific key]

**Selected Because:**
- [Reason 1: e.g., Compatible with Anthropic's Claude models]
- [Reason 2: e.g., Lower latency or better pricing]
- [Reason 3: e.g., Regulatory compliance]

**Testing Status:**
- [e.g., API key verified, connection tested, model accessible]
```