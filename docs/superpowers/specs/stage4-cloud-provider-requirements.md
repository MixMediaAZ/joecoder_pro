# Stage 4: Second Cloud Provider Configuration

**Stage Number:** 4
**Date:** 2026-08-10
**Status:** PENDING OPERATOR DECISION
**Source:** JOECODER_PRO_20.1_CONTROLLING_FINISH_SPEC_v3_DRAFT

## Stage 4 Requirement

**Second cloud provider configuration** — The agent must be configured with redundancy and failover capabilities through a secondary cloud provider for disaster recovery and availability.

## Core Requirements

1. **Redundancy and failover capability**
   - Configure at least one secondary cloud provider
   - Enable automatic failover to secondary provider
   - Maintain service availability during primary provider issues

2. **Evidence requirement: operator decision**
   - Operator must decide on cloud provider strategy
   - Operator must document provider choice and reasoning
   - Operator must verify configuration and evidence

3. **No fabricated evidence: All evidence from actual configuration**
   - Configuration must be executed with real API keys and credentials
   - All evidence must be traceable to actual configuration
   - Mock configuration or synthetic evidence is prohibited

4. **Real implementation required**
   - Actual cloud provider API integration
   - Real API keys and credentials
   - Real failover testing and verification

## Implementation Guide

### Step 1: Define Cloud Provider Strategy

**Decision Points:**

1. **Do we need a second cloud provider?**
   - YES: Proceed with configuration
   - NO: Document reasoning and skip to Stage 5

2. **Which cloud provider to use?**
   - AWS (Amazon Web Services)
   - Google Cloud Platform (GCP)
   - Azure (Microsoft Azure)
   - Self-hosted alternative (if applicable)

3. **What is the failover strategy?**
   - Primary: Current provider (e.g., Anthropic or local Ollama)
   - Secondary: [Selected provider]
   - Failover mechanism: [e.g., auto-switchover based on latency, availability, or manual trigger]

### Step 2: Choose Primary Provider

**Current Primary Provider (from Stage 1 Receipt):**
```
JC_OLLAMA_MODEL: qwen2.5-coder:14b
JC_MOCK_MODEL: 0
Model Location: Local (Ollama)
```

**Primary Provider Advantages:**
- ✅ No API costs
- ✅ No network dependencies
- ✅ Complete offline capability
- ✅ Data privacy (data never leaves local machine)

### Step 3: Choose Secondary Provider Options

#### Option A: AWS (Amazon Web Services)

**Pros:**
- Widely adopted enterprise provider
- Mature AI model services (Bedrock, SageMaker)
- Good pricing options
- Global infrastructure

**Cons:**
- API costs
- Configuration complexity
- Data egress costs
- Requires AWS account and credentials

**Implementation:**
```powershell
# Install AWS CLI
npm install -g aws-cli

# Configure AWS credentials
aws configure

# Choose one of these AI model services:
# 1. Bedrock - Managed AI model access
# 2. SageMaker - Custom model hosting
# 3. SageMaker JumpStart - Pre-built models
```

#### Option B: Google Cloud Platform (GCP)

**Pros:**
- Excellent AI/ML capabilities
- Vertex AI platform
- Good pricing options
- Strong ecosystem

**Cons:**
- API costs
- Configuration complexity
- Data egress costs
- Requires GCP account and credentials

**Implementation:**
```powershell
# Install Google Cloud CLI
npm install -g gcloud-cli

# Configure GCP credentials
gcloud auth login

# Choose Vertex AI for AI model services
```

#### Option C: Azure (Microsoft Azure)

**Pros:**
- Strong enterprise integration
- Azure OpenAI Service
- Good pricing options
- Microsoft ecosystem

**Cons:**
- API costs
- Configuration complexity
- Data egress costs
- Requires Azure account and credentials

**Implementation:**
```powershell
# Install Azure CLI
npm install -g azure-cli

# Configure Azure credentials
az login

# Use Azure OpenAI Service for AI capabilities
```

#### Option D: Self-Hosted Alternative

**Pros:**
- No API costs
- Complete control
- Data never leaves infrastructure
- Offline capability maintained

**Cons:**
- Requires separate hardware
- Requires maintenance
- Manual failover
- May not be feasible for all use cases

**Implementation:**
```powershell
# Deploy on separate server/VM
# Configure JoeCoder Pro 20.1 as secondary instance
# Implement manual failover mechanism
```

### Step 4: Implementation (Example with AWS)

**Prerequisites:**
- AWS account with API access
- AWS CLI installed and configured
- API keys for AI model service (Bedrock, SageMaker, etc.)
- Knowledge of cloud architecture and networking

**Implementation Steps:**

```powershell
# 1. Install AWS CLI
npm install -g aws-cli

# 2. Configure AWS credentials
# aws configure
# Set: AWS Access Key ID
# Set: AWS Secret Access Key
# Set: Default region (e.g., us-east-1)
# Set: Default output format (e.g., json)

# 3. Configure secondary provider in JoeCoder
# Edit config:
$env:JC_SECONDARY_PROVIDER = "aws"
$env:JC_AWS_REGION = "us-east-1"
$env:JC_AWS_MODEL = "amazon.titan-tg1"  # or other Bedrock model
$env:JC_CLOUD_BUDGET_USD = "5"

# 4. Test connection
aws sts get-caller-identity

# 5. Verify API access to AI model service
# [AWS specific verification]

# 6. Document configuration
# [Save configuration details to evidence file]
```

### Step 5: Verification

**Verification Checklist:**
- [ ] Cloud provider CLI successfully configured
- [ ] API credentials validated
- [ ] Connection to cloud provider established
- [ ] AI model service accessible
- [ ] Failover mechanism documented
- [ ] Configuration tested and verified
- [ ] Evidence files created

### Step 6: Documentation

**Evidence Files Required:**

1. **Provider Selection Document:**
   ```
   Stage 4: Cloud Provider Selection
   Date: [YYYY-MM-DD]
   Decision: [Approved/Rejected]
   Primary Provider: [Current provider]
   Secondary Provider: [Chosen provider]
   Reasoning: [Your reasoning]
   ```

2. **Configuration Document:**
   ```
   Stage 4: Configuration Details
   Date: [YYYY-MM-DD]
   Secondary Provider: [Provider name]
   API Keys: [Redacted - stored securely]
   Failover Strategy: [Description]
   Model Used: [Model name]
   Cost Estimate: [Monthly cost estimate]
   ```

3. **Verification Document:**
   ```
   Stage 4: Verification Results
   Date: [YYYY-MM-DD]
   Connection Test: [Passed/Failed]
   API Test: [Passed/Failed]
   Failover Test: [Passed/Failed]
   ```

4. **Signed Receipt:**
   ```
   CERT-STAGE4-CLOUD-PROVIDER-[TIMESTAMP].json
   ```

## Success Criteria

- ✅ Cloud provider configured (or decision documented for rejection)
- ✅ Evidence preserved in signed form
- ✅ All receipts bound to candidate commit
- ✅ Configuration documented
- ✅ Verification tests performed

## Evidence Requirements

1. Provider selection document (operator decision)
2. Configuration document (if provider selected)
3. Verification results (if provider configured)
4. Signed receipt for Stage 4 configuration
5. All evidence preserved in signed manifest

## Decision Criteria

### Should Configure Second Cloud Provider?

**RECOMMEND: DO NOT CONFIGURE for this use case**

**Reasoning:**
1. **Primary provider (local Ollama) already provides:**
   - Zero cost
   - Zero latency
   - Complete offline capability
   - Data privacy
   - No external dependencies

2. **Secondary cloud provider would introduce:**
   - API costs
   - Network latency
   - Data egress costs
   - External dependencies
   - Reduced privacy

3. **Disaster recovery considerations:**
   - Local Ollama can be backed up locally
   - System can be easily restored from backups
   - No need for expensive cloud redundancy
   - Cost-benefit analysis favors local-only solution

4. **Operator workflow:**
   - JoeCoder Pro 20.1 is designed for local development
   - Operator's primary use case is offline development
   - Cloud providers are overkill for this use case
   - Local-only approach is more aligned with user requirements

**Alternative:**
- Use local backup and restore procedures for disaster recovery
- Keep local Ollama as both primary and only provider
- Document this decision as part of mandate compliance

### If Operator Chooses to Configure

If you still choose to configure a second cloud provider (e.g., for enterprise redundancy requirements), follow the implementation guide and document your decision.

## Timeline Estimate

- Decision making: 15-30 minutes
- Configuration (if chosen): 30-60 minutes
- Verification: 15-30 minutes
- Documentation: 15-30 minutes
- **Total: 1-2 hours**

## Notes

- Stage 4 is optional based on use case and requirements
- Local-only solution is recommended for this use case
- Configuration requires valid cloud provider credentials
- Secondary provider adds complexity and cost
- Evidence must be preserved in signed form
- Operator must document decision and reasoning