import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const planRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(planRoot, "..");
const errors = [];
const warnings = [];
const checks = [];

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function record(name, ok, detail) {
  checks.push({ name, status: ok ? "passed" : "failed", detail });
  if (!ok) errors.push({ code: name, detail });
}

function readText(relativePath) {
  const file = path.join(planRoot, relativePath);
  if (!fs.existsSync(file)) {
    record("FILE_" + relativePath, false, "Required file is missing.");
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    record("JSON_" + relativePath, false, String(error.message));
    return null;
  }
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "PLAN_AMENDMENT_1.3.md",
  "PLAN_AMENDMENT_1.3.1.md",
  "BOOTSTRAP_CONSTRUCTION_PROTOCOL.md",
  "source-manifest.json",
  "audit/README.md",
  "audit/audit-index.json",
  "contracts/CONFIGURATION_AND_POLICY.md",
  "contracts/LOCAL_SESSION.md",
  "contracts/FAILURE_OWNERSHIP.md",
  "contracts/ARCHITECTURE_QUALIFICATION.md",
  "contracts/UX_FOUNDATION.md",
  "schemas/work-order.schema.json",
  "schemas/rule-registry.schema.json",
  "schemas/evidence-envelope.schema.json",
  "schemas/policy-decision.schema.json",
  "schemas/configuration-status.schema.json",
  "schemas/session.schema.json",
  "schemas/failure-ownership.schema.json",
  "spec/rules.json",
  "spec/plan-status.json",
  "spec/build-plan.json",
  "spec/work-order-catalog.json",
  "spec/traceability.json",
  "spec/fixture-contracts.json",
  "spec/configuration-keys.json",
  "spec/api-contract.json",
  "spec/architecture-qualification.json",
  "spec/rollback-strategy-map.json",
  "fixtures/contracts/valid-work-order.json",
  "fixtures/contracts/invalid/missing-source-plan-hash.json",
  "fixtures/contracts/invalid/unknown-field.json",
  "fixtures/contracts/invalid/bad-id.json",
  "fixtures/contracts/invalid/empty-scope.json",
  "fixtures/contracts/invalid/bad-dependency-state.json",
  "fixtures/contracts/invalid/shell-string-command.json",
  "scripts/validate-plan.mjs"
];

for (const file of requiredFiles) {
  record("FILE_PRESENT_" + file, fs.existsSync(path.join(planRoot, file)), "Required ratification artifact exists.");
}

const sourceManifest = readJson("source-manifest.json");
const auditIndex = readJson("audit/audit-index.json");
const status = readJson("spec/plan-status.json");
const rulesDoc = readJson("spec/rules.json");
const buildPlan = readJson("spec/build-plan.json");
const catalogDoc = readJson("spec/work-order-catalog.json");
const trace = readJson("spec/traceability.json");
const fixtureContractsDoc = readJson("spec/fixture-contracts.json");
const configuration = readJson("spec/configuration-keys.json");
const api = readJson("spec/api-contract.json");
const qualification = readJson("spec/architecture-qualification.json");
const rollbackMap = readJson("spec/rollback-strategy-map.json");
const validWorkOrder = readJson("fixtures/contracts/valid-work-order.json");

let sourceHashesValid = true;
for (const source of sourceManifest ? sourceManifest.sources : []) {
  const file = path.join(projectRoot, source.path);
  if (!fs.existsSync(file) || sha256File(file) !== source.sha256) sourceHashesValid = false;
}
record("PINNED_SOURCE_HASHES", sourceManifest && sourceManifest.sources.length === 18 && sourceHashesValid, "All 18 admitted source inputs exist and match their ratified SHA-256 values.");

let auditHashesValid = true;
for (const artifact of auditIndex ? auditIndex.artifacts : []) {
  const file = path.join(projectRoot, artifact.path);
  if (!fs.existsSync(file) || sha256File(file) !== artifact.sha256 || artifact.classification !== "superseded_non_governing_audit_history") auditHashesValid = false;
}
record("AUDIT_HISTORY_HASHES", auditIndex && auditIndex.artifacts.length >= 30 && auditHashesValid, "Superseded root planning artifacts remain intact and explicitly non-governing.");

record("PLAN_VERSION_STATUS", status && status.planVersion === "1.3.1" && status.state === "ratified_not_implementation_authorized", "The effective plan is ratified 1.3.1 and not implementation-authorized.");
record("BUILD_PLAN_VERSION", buildPlan && buildPlan.planVersion === "1.3.1" && buildPlan.amendment === "../PLAN_AMENDMENT_1.3.1.md", "The build graph names Plan Amendment 1.3.1 as its effective authority.");
record("NO_IMPLEMENTATION_AUTHORIZATION", status && status.applicationImplementationStarted === false && status.applicationImplementationAuthorized === false && status.authorizedWorkOrderIds.length === 0, "Ratification did not authorize or start application implementation.");

const noScaffold = !["package.json", "package-lock.json"].some((name) => fs.existsSync(path.join(projectRoot, name))) &&
  !["apps", "packages"].some((name) => fs.existsSync(path.join(projectRoot, name)));
record("NO_APPLICATION_SCAFFOLD", noScaffold, "No root npm workspace, apps directory, or packages directory was created during planning.");

const rules = rulesDoc && Array.isArray(rulesDoc.rules) ? rulesDoc.rules : [];
const ruleIds = rules.map((rule) => rule.id);
record("RULES_APPROVED_48", rulesDoc && rulesDoc.specVersion === "1.3.1" && rulesDoc.status === "approved" && ruleIds.length === 48, "The effective registry contains 48 approved version-1.3.1 laws.");
record("RULE_IDS_UNIQUE", new Set(ruleIds).size === ruleIds.length, "Canonical law IDs are unique.");

const tasks = buildPlan && Array.isArray(buildPlan.workOrders) ? buildPlan.workOrders : [];
const taskIds = tasks.map((task) => task.id);
const taskIndex = new Map(tasks.map((task, index) => [task.id, index]));
record("WORK_ORDER_COUNT_95", tasks.length === 95 && new Set(taskIds).size === 95, "The ratified graph contains 95 unique Work Orders.");
record("M3_QUALIFICATION_INSERTED", taskIds.includes("JC19-M3-000") && tasks.find((task) => task.id === "JC19-M3-001").dependsOn.length === 1 && tasks.find((task) => task.id === "JC19-M3-001").dependsOn[0] === "JC19-M3-000", "Windows isolation qualification gates all later M3 broker work.");

let dependenciesValid = true;
for (const task of tasks) {
  for (const dependency of task.dependsOn || []) {
    if (!taskIndex.has(dependency) || taskIndex.get(dependency) >= taskIndex.get(task.id)) dependenciesValid = false;
  }
}
record("DEPENDENCIES_EXIST_AND_PRECEDE", dependenciesValid, "Every dependency exists and precedes its dependent task.");

const visiting = new Set();
const visited = new Set();
let acyclic = true;
function visit(id) {
  if (visiting.has(id)) {
    acyclic = false;
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  const task = tasks.find((entry) => entry.id === id);
  for (const dependency of task ? task.dependsOn || [] : []) visit(dependency);
  visiting.delete(id);
  visited.add(id);
}
for (const id of taskIds) visit(id);
record("DEPENDENCY_GRAPH_ACYCLIC", acyclic, "The 95-task graph has no cycle.");

const milestoneExits = new Set((buildPlan && buildPlan.milestones || []).map((milestone) => milestone.exitWorkOrder));
record("MILESTONE_EXITS", milestoneExits.size === 10 && [...milestoneExits].every((id) => taskIndex.has(id)), "All ten milestones have valid exit Work Orders.");
record("DEPENDENCY_COMPLETION_SEMANTICS", buildPlan && buildPlan.executionPolicy.dependencyRequiredState === "completed" && buildPlan.executionPolicy.dependencyVerifiedEvidenceRequired === true, "Dependencies use the real completed state and require verified evidence.");
record("FIRST_CANDIDATE_NOT_AUTHORIZED", buildPlan && buildPlan.executionPolicy.firstCandidateWorkOrderId === "JC19-M0-001" && buildPlan.executionPolicy.authorizedWorkOrderIds.length === 0, "JC19-M0-001 is only the first candidate.");

const details = catalogDoc && Array.isArray(catalogDoc.workOrders) ? catalogDoc.workOrders : [];
const detailMap = new Map(details.map((detail) => [detail.id, detail]));
record("CATALOG_ONE_TO_ONE", details.length === 95 && detailMap.size === 95 && taskIds.every((id) => detailMap.has(id)), "Every graph task has exactly one planning detail record.");

const requiredDetailFields = ["roles", "objective", "plannedComponentPaths", "nonGoals", "assumptions", "constraints", "deliverables", "acceptance", "testIds", "fixtureIds", "evidenceIds", "rules", "dependencies", "risk", "budgets", "authorization", "rollback", "evidence"];
let detailComplete = true;
let conventionsValid = true;
for (const task of tasks) {
  const detail = detailMap.get(task.id);
  if (!detail) {
    detailComplete = false;
    continue;
  }
  for (const field of requiredDetailFields) {
    if (detail[field] === undefined || detail[field] === null) detailComplete = false;
  }
  if (!Array.isArray(detail.plannedComponentPaths) || !detail.plannedComponentPaths.length || detail.exactPathAllowlistRequiredBeforeAuthorization !== true) detailComplete = false;
  if (!Array.isArray(detail.acceptance) || detail.acceptance.length < 4 || !detail.acceptance.every((item) => item.mandatory === true)) detailComplete = false;
  if (detail.status !== "planned_unapproved" || detail.authorization.granted !== false || detail.authorization.status !== "not_requested") conventionsValid = false;
  if (JSON.stringify(detail.rules) !== JSON.stringify(task.rules)) conventionsValid = false;
  if (JSON.stringify(detail.dependencies.map((dependency) => dependency.id)) !== JSON.stringify(task.dependsOn)) conventionsValid = false;
  if (JSON.stringify(detail.testIds) !== JSON.stringify(["T-" + task.id, "TN-" + task.id])) conventionsValid = false;
  if (!detail.evidenceIds.includes("E-" + task.id)) conventionsValid = false;
}
record("CATALOG_DETAIL_COMPLETE", detailComplete, "All 95 tasks carry mandatory planning detail and require exact paths before authorization.");
record("CATALOG_CONVENTIONS", conventionsValid, "Status, authorization, dependencies, rules, tests, and evidence IDs match the graph.");

const bannedAcceptanceFragments = [
  "The fixed deliverable is implemented within declared component boundaries:",
  "A task-specific forced failure or bypass attempt is rejected without mutation or false pass.",
  "Applicable regression fixtures pass and the evidence envelope hashes raw artifacts."
];
const acceptanceCriteria = details.flatMap((detail) => detail.acceptance.map((item) => item.criterion));
record(
  "SEMANTIC_ACCEPTANCE_NO_COPY_THROUGH",
  acceptanceCriteria.every((criterion) => bannedAcceptanceFragments.every((fragment) => !criterion.includes(fragment))),
  "Generic acceptance copy-through is absent from every Work Order."
);
record(
  "SEMANTIC_ACCEPTANCE_UNIQUE",
  new Set(acceptanceCriteria).size === acceptanceCriteria.length,
  "Every acceptance criterion is task-bound and textually unique."
);
const masterPlan = fs.readFileSync(path.join(projectRoot, "JOECODER_IMPLEMENTATION_MASTER_PLAN.md"), "utf8");
const sourceExitProofs = new Map(
  [...masterPlan.matchAll(/^\| (JC19-M[0-9]+-[0-9]{3}) \| [^|]+ \| ([^|]+) \|$/gm)]
    .map((match) => [match[1], match[2].trim()])
);
const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
const semanticAcceptanceBound = details.filter((detail) => !/^JC19-M0-/.test(detail.id)).every((detail) => {
  const [lawCriterion, exitCriterion, negativeCriterion, evidenceCriterion] = detail.acceptance;
  const sourceExitProof = sourceExitProofs.get(detail.id);
  const lawBound = detail.rules.every((id) => {
    const rule = rulesById.get(id);
    return rule && lawCriterion.criterion.includes(id) && lawCriterion.criterion.includes(rule.requirement);
  });
  const exitBound = detail.id === "JC19-M3-000"
    ? exitCriterion.criterion.includes("before any process-execution broker implementation begins")
    : sourceExitProof && exitCriterion.criterion.includes(sourceExitProof);
  const fixturesBound = detail.fixtureIds.every((id) => negativeCriterion.criterion.includes(id)) &&
    negativeCriterion.criterion.includes("assert every expected and forbidden outcome");
  const evidenceBound = evidenceCriterion.criterion.includes(detail.evidenceIds[0]) &&
    evidenceCriterion.criterion.includes(detail.objective) &&
    detail.rules.every((id) => evidenceCriterion.criterion.includes(id));
  return detail.acceptance.length === 4 &&
    lawCriterion.verifier === detail.testIds[0] && exitCriterion.verifier === detail.testIds[0] &&
    negativeCriterion.verifier === detail.testIds[1] &&
    lawCriterion.criterion.includes(detail.objective) && lawBound && exitBound && fixturesBound && evidenceBound;
});
record(
  "SEMANTIC_ACCEPTANCE_SOURCE_BOUND",
  semanticAcceptanceBound,
  "Every M1-M9 acceptance set binds its objective, full law requirements, source exit proof, exact fixture oracles, tests, and evidence ID."
);

const m0Details = details.filter((detail) => /^JC19-M0-00[1-7]$/.test(detail.id));
const m0Scopes = m0Details.map((detail) => JSON.stringify(detail.plannedComponentPaths));
record("M0_SEVEN_DISTINCT_TASKS", m0Details.length === 7 && new Set(m0Scopes).size === 7, "M0 has seven separately scoped Work Orders.");
const m0001 = detailMap.get("JC19-M0-001");
const forbiddenM0001 = ["schema", "orchestrator", "apps/", "packages/", "provider", "worker"];
record("M0_001_NARROW_SCOPE", m0001 && m0001.plannedComponentPaths.every((entry) => !forbiddenM0001.some((term) => entry.toLowerCase().includes(term))) && m0001.network.length === 0 && m0001.providers.length === 0 && m0001.secrets.length === 0, "M0-001 is limited to root workspace and runtime artifacts.");
record("M0_TASK_SPECIFIC_ACCEPTANCE", m0Details.every((detail) => detail.acceptance.length === 4 && detail.fixtureIds.length > 0 && detail.budgets.maxCloudCostUsd === 0), "Every M0 task has four task-specific criteria, named fixtures, and zero cloud budget.");
record("BOOTSTRAP_GOVERNANCE_MODES", details.filter((detail) => /^JC19-M[0-2]-/.test(detail.id)).every((detail) => detail.governanceMode === "bootstrap_external") && detailMap.get("JC19-M3-000").governanceMode === "governance_assisted", "Governance claims advance only after the corresponding system exists.");

const fixturePlan = fs.readFileSync(path.join(projectRoot, "docs", "TEST_AND_CERTIFICATION_PLAN.md"), "utf8");
const fixtureSourceEntries = [...fixturePlan.matchAll(/^- `(FX-[A-Z0-9-]+)` (.+)$/gm)].map((match) => ({ id: match[1], trigger: match[2].replace(/\.$/, "") }));
const fixtureContracts = fixtureContractsDoc && Array.isArray(fixtureContractsDoc.fixtures) ? fixtureContractsDoc.fixtures : [];
const fixtureIds = fixtureContracts.map((fixture) => fixture.id).sort();
const fixtureSourceMap = new Map(fixtureSourceEntries.map((fixture) => [fixture.id, fixture.trigger]));
record(
  "FIXTURE_CONTRACTS_COMPLETE",
  fixtureContractsDoc && fixtureContractsDoc.schemaVersion === "1.3.1" && fixtureContracts.length === 84 &&
    new Set(fixtureIds).size === 84 && fixtureContracts.every((fixture) =>
      fixtureSourceMap.get(fixture.id) === fixture.trigger &&
      typeof fixture.expectedOutcome === "string" && fixture.expectedOutcome.length >= 20 &&
      Array.isArray(fixture.forbiddenOutcomes) && fixture.forbiddenOutcomes.length > 0 &&
      Array.isArray(fixture.requiredEvidence) && fixture.requiredEvidence.length > 0
    ),
  "All 84 fixtures have source-pinned triggers, expected outcomes, forbidden outcomes, and evidence obligations."
);
record(
  "FIXTURE_OUTCOMES_SEMANTICALLY_DISTINCT",
  new Set(fixtureContracts.map((fixture) => fixture.expectedOutcome)).size === fixtureContracts.length &&
    fixtureContractsDoc.rule.includes("implemented as an executable oracle before it can count as proof"),
  "Each fixture has a scenario-specific expected outcome, and planning prose alone is explicitly non-probative."
);
const catalogFixtureIds = [...new Set(details.flatMap((detail) => detail.fixtureIds))].sort();
record("FIXTURE_INVENTORY_84", fixtureIds.length === 84 && fixtureSourceEntries.length === 84, "The admitted certification plan and effective oracle catalog contain the same 84 canonical fixture IDs.");
record("NO_UNKNOWN_FIXTURE_REFERENCES", catalogFixtureIds.every((id) => fixtureIds.includes(id)), "Every catalog fixture reference exists in the canonical initial inventory.");
record("ALL_FIXTURES_PLANNED", fixtureIds.every((id) => catalogFixtureIds.includes(id)), "Every initial fixture is exercised by at least one planned Work Order.");

const relevanceCorrectedIds = new Set([
  "JC19-M1-001", "JC19-M1-002", "JC19-M1-003", "JC19-M1-004", "JC19-M1-007",
  "JC19-M3-003", "JC19-M5-001", "JC19-M5-010", "JC19-M5-011", "JC19-M6-007",
  "JC19-M7-001", "JC19-M8-004", "JC19-M9-001", "JC19-M9-003", "JC19-M9-005"
]);
record(
  "TASK_FIXTURE_RELEVANCE_CORRECTED",
  [...relevanceCorrectedIds].every((id) => {
    const detail = detailMap.get(id);
    return detail && !(detail.fixtureIds.length === 1 && detail.fixtureIds[0] === "FX-BUILD-001");
  }),
  "Known irrelevant or underpowered FX-BUILD-001-only mappings are replaced by task-relevant adversarial sets."
);

const referencedRules = new Set(tasks.flatMap((task) => task.rules));
record("NO_UNKNOWN_RULE_REFERENCES", [...referencedRules].every((id) => ruleIds.includes(id)), "The build graph references only canonical laws.");
record("ALL_RULES_PLANNED", ruleIds.every((id) => referencedRules.has(id)), "Every law maps to planned enforcement.");

const traceWorkOrders = trace && Array.isArray(trace.workOrders) ? trace.workOrders : [];
const traceRules = trace && Array.isArray(trace.rules) ? trace.rules : [];
const traceWorkOrderMap = new Map(traceWorkOrders.map((entry) => [entry.workOrderId, entry]));
const traceRuleMap = new Map(traceRules.map((entry) => [entry.ruleId, entry]));
record("TRACE_COUNTS", trace && trace.ruleCount === 48 && trace.workOrderCount === 95 && trace.fixtureInventoryCount === 84, "Traceability declares 48 laws, 95 Work Orders, and 84 fixtures.");
let traceValid = taskIds.every((id) => traceWorkOrderMap.has(id)) && ruleIds.every((id) => traceRuleMap.has(id));
for (const detail of details) {
  const entry = traceWorkOrderMap.get(detail.id);
  if (!entry) {
    traceValid = false;
    continue;
  }
  if (JSON.stringify(entry.ruleIds) !== JSON.stringify(detail.rules)) traceValid = false;
  if (JSON.stringify(entry.acceptanceIds) !== JSON.stringify(detail.acceptance.map((item) => item.id))) traceValid = false;
  if (JSON.stringify(entry.testIds) !== JSON.stringify(detail.testIds)) traceValid = false;
  if (JSON.stringify(entry.fixtureIds) !== JSON.stringify(detail.fixtureIds)) traceValid = false;
  if (JSON.stringify(entry.evidenceIds) !== JSON.stringify(detail.evidenceIds)) traceValid = false;
}
if (!traceRules.every((entry) => Array.isArray(entry.proofChains) && entry.proofChains.length > 0)) traceValid = false;
for (const entry of traceRules) {
  for (const chain of entry.proofChains || []) {
    const detail = detailMap.get(chain.workOrderId);
    if (!detail || JSON.stringify(chain.fixtureIds) !== JSON.stringify(detail.fixtureIds)) traceValid = false;
  }
}
record("TRACE_FULL_CHAIN", traceValid, "Rule to Work Order to acceptance to test to fixture to evidence chains are exact.");

const processCount = configuration && configuration.keys.find((entry) => entry.key === "JC_MAX_PROCESS_COUNT");
record("CONFIG_PROCESS_COUNT_32", processCount && processCount.default === 32 && processCount.maximum === 128, "The canonical default process count is 32.");
record("CONFIG_SECURITY_LATTICE", readText("contracts/CONFIGURATION_AND_POLICY.md").includes("Effective capability is the intersection") && readText("contracts/CONFIGURATION_AND_POLICY.md").includes("Configuration can never create authority"), "Configuration cannot override security policy.");

const routeKeys = new Set((api ? api.routes : []).map((route) => route.method + " " + route.path));
record("SESSION_API_WIRED", ["POST /session/exchange", "POST /session/refresh", "POST /session/logout", "GET /session/status"].every((key) => routeKeys.has(key)), "All frozen local-session routes exist in the machine API contract.");
record("SESSION_CONTRACT_EXPLICIT", ["HttpOnly", "SameSite=Strict", "X-JC-CSRF", "30 minutes", "8 hours"].every((term) => readText("contracts/LOCAL_SESSION.md").includes(term)), "Cookie, CSRF, origin, storage, and lifetime behavior are explicit.");
record("FAILURE_OWNERSHIP_PROBES", ["JC_CONTROL", "HOST_ENVIRONMENT", "PROJECT", "UNKNOWN", "A timeout proves only"].every((term) => readText("contracts/FAILURE_OWNERSHIP.md").includes(term)), "Failure ownership and timeout attribution require discriminating evidence.");
record("UX_FOUNDATION_GATED", readText("contracts/UX_FOUNDATION.md").includes("UI implementation remains prohibited until Milestone 7") && readText("contracts/UX_FOUNDATION.md").includes("UI state never creates permission"), "UX foundations are specified without starting decorative UI.");
record("ARCHITECTURE_QUALIFICATION_CONTRACT", qualification && qualification.id === "JC19-M3-000" && qualification.failureAction.includes("architecture_change"), "Failed Windows qualification stops M3 and requires change control.");
const m1004Detail = detailMap.get("JC19-M1-004");
const m1004Task = tasks.find((task) => task.id === "JC19-M1-004");
record(
  "BROKER_QUALIFICATION_SEQUENCE",
  m1004Task && m1004Task.title === "Non-executing broker IPC foundation" &&
    m1004Detail && m1004Detail.nonGoals.some((item) => item.includes("native process creation")) &&
    qualification && qualification.schemaVersion === "1.3.1" &&
    qualification.m1PermittedFoundation.includes("authenticated non-executing IPC") &&
    qualification.m1ProhibitedCapabilities.includes("native process creation") &&
    qualification.gatedCapabilities.includes("project command execution") &&
    readText("contracts/ARCHITECTURE_QUALIFICATION.md").includes("before native process-execution") &&
    tasks.find((task) => task.id === "JC19-M3-001").dependsOn[0] === "JC19-M3-000",
  "M1 is limited to non-executing IPC/file-service foundations and M3-000 gates native process execution and isolation."
);

const rollbackPlanningValues = new Set(details.map((detail) => detail.rollback.strategy));
const rollbackMappings = new Map((rollbackMap ? rollbackMap.mappings : []).map((entry) => [entry.planning, entry.allowedGenerated]));
record("ROLLBACK_STRATEGY_MAPPING", [...rollbackPlanningValues].every((value) => rollbackMappings.has(value)) && [...rollbackMappings.values()].flat().every((value) => ["version_pointer", "journaled_materialization", "none_read_only"].includes(value)), "Every planning rollback category maps to an allowed generated Work Order strategy.");

const schemaFiles = [
  "schemas/work-order.schema.json",
  "schemas/rule-registry.schema.json",
  "schemas/evidence-envelope.schema.json",
  "schemas/policy-decision.schema.json",
  "schemas/configuration-status.schema.json",
  "schemas/session.schema.json",
  "schemas/failure-ownership.schema.json"
];
const invalidFiles = [
  "fixtures/contracts/invalid/missing-source-plan-hash.json",
  "fixtures/contracts/invalid/unknown-field.json",
  "fixtures/contracts/invalid/bad-id.json",
  "fixtures/contracts/invalid/empty-scope.json",
  "fixtures/contracts/invalid/bad-dependency-state.json",
  "fixtures/contracts/invalid/shell-string-command.json"
];
const pythonCode = [
  "import json,pathlib",
  "from jsonschema import Draft202012Validator",
  "r=pathlib.Path('.')",
  "schema_files=" + JSON.stringify(schemaFiles),
  "schemas={f:json.loads((r/f).read_text(encoding='utf-8-sig')) for f in schema_files}",
  "[Draft202012Validator.check_schema(s) for s in schemas.values()]",
  "rules=json.loads((r/'spec/rules.json').read_text(encoding='utf-8-sig'))",
  "rule_errors=list(Draft202012Validator(schemas['schemas/rule-registry.schema.json']).iter_errors(rules))",
  "valid=json.loads((r/'fixtures/contracts/valid-work-order.json').read_text(encoding='utf-8-sig'))",
  "wo_validator=Draft202012Validator(schemas['schemas/work-order.schema.json'])",
  "valid_errors=list(wo_validator.iter_errors(valid))",
  "invalid_files=" + JSON.stringify(invalidFiles),
  "invalid_rejected={f:bool(list(wo_validator.iter_errors(json.loads((r/f).read_text(encoding='utf-8-sig'))))) for f in invalid_files}",
  "empty_rejected=all(bool(list(Draft202012Validator(schemas[f]).iter_errors({}))) for f in ['schemas/work-order.schema.json','schemas/evidence-envelope.schema.json','schemas/policy-decision.schema.json','schemas/configuration-status.schema.json','schemas/failure-ownership.schema.json'])",
  "result={'engine':'python-jsonschema','draft':'2020-12','schemasCompiled':schema_files,'rulesValid':not rule_errors,'ruleErrors':[e.message for e in rule_errors[:10]],'validWorkOrder':not valid_errors,'validWorkOrderErrors':[e.message for e in valid_errors[:10]],'invalidRejected':invalid_rejected,'emptyRejected':empty_rejected}",
  "print(json.dumps(result))",
  "raise SystemExit(0 if all([result['rulesValid'],result['validWorkOrder'],all(invalid_rejected.values()),empty_rejected]) else 1)"
].join(";");

const formalRun = spawnSync("python", ["-c", pythonCode], { cwd: planRoot, encoding: "utf8", windowsHide: true });
let formal;
try {
  formal = JSON.parse((formalRun.stdout || "").trim());
} catch {
  formal = { engine: "unavailable", draft: "2020-12", schemasCompiled: [], rulesValid: false, ruleErrors: [formalRun.stderr || "No formal validation result."], validWorkOrder: false, validWorkOrderErrors: [], invalidRejected: {}, emptyRejected: false };
}
record("FORMAL_SCHEMA_COMPILATION", formalRun.status === 0 && formal.schemasCompiled.length === 7, formalRun.status === 0 ? "All seven effective schemas compile under Draft 2020-12." : formal.ruleErrors.join("; "));
record("FORMAL_RULE_REGISTRY", formal.rulesValid === true, "The approved 48-law registry validates formally.");
record("FORMAL_VALID_WORK_ORDER", formal.validWorkOrder === true, formal.validWorkOrder ? "The representative M0-001 Work Order validates." : formal.validWorkOrderErrors.join("; "));
record("FORMAL_INVALID_WORK_ORDERS", invalidFiles.every((file) => formal.invalidRejected[file] === true), "All six adversarial Work Order instances are rejected.");
record("FORMAL_EMPTY_CONTRACTS", formal.emptyRejected === true, "Empty consequential contract instances are rejected.");

const excluded = new Set(["validation-report.json", "ratification-manifest.json"]);
function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(absolute));
    else result.push(absolute);
  }
  return result;
}
const ratifiedFiles = listFiles(planRoot)
  .map((absolute) => ({ absolute, relative: path.relative(planRoot, absolute).replaceAll("\\", "/") }))
  .filter((entry) => !excluded.has(entry.relative))
  .sort((a, b) => a.relative.localeCompare(b.relative));
const fileHashes = ratifiedFiles.map((entry) => ({ path: entry.relative, sha256: sha256File(entry.absolute) }));
const rootHash = sha256Buffer(fileHashes.map((entry) => entry.path + "\0" + entry.sha256).join("\n"));

const ratificationManifest = {
  schemaVersion: "1.3.1",
  algorithm: "sha256",
  planRootHash: rootHash,
  files: fileHashes
};
fs.writeFileSync(path.join(planRoot, "ratification-manifest.json"), JSON.stringify(ratificationManifest, null, 2) + "\n", "utf8");

const report = {
  schemaVersion: "1.3.1",
  generatedAt: new Date().toISOString(),
  validator: "scripts/validate-plan.mjs",
  state: errors.length === 0 ? "passed" : "failed",
  implementationAuthorized: false,
  planRootHash: rootHash,
  counts: {
    checks: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: errors.length,
    warnings: warnings.length,
    rules: ruleIds.length,
    workOrders: taskIds.length,
    fixtures: fixtureIds.length,
    pinnedSources: sourceManifest ? sourceManifest.sources.length : 0,
    auditArtifacts: auditIndex ? auditIndex.artifacts.length : 0,
    ratifiedFiles: fileHashes.length
  },
  formalValidation: formal,
  checks,
  errors,
  warnings,
  notes: [
    "Parent-directory planning artifacts are pinned source or non-governing audit history.",
    "Plan Amendment 1.3.1 removes semantic acceptance copy-through and makes the M1/M3 broker boundary explicit.",
    "Application implementation and project-source mutation remain unauthorized; only ratified planning artifacts were amended.",
    "Passing this report ratifies planning only and does not authorize JC19-M0-001."
  ]
};
fs.writeFileSync(path.join(planRoot, "validation-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = errors.length === 0 ? 0 : 1;
