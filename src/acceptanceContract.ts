import { z } from 'zod';

const TerminalSchema = z.enum([
  'completed', 'completed_with_limits', 'blocked_for_user', 'failed_safe', 'cancelled', 'interrupted'
]);

const CommonAssertionsSchema = z.object({
  changedPaths: z.array(z.string()).min(0),
  untouchedPaths: z.array(z.string()).min(1),
  checks: z.array(z.string()).min(1),
  evidenceIntegrity: z.literal(true),
  rollback: z.enum(['snapshot_restore', 'automatic_restore', 'no_mutation']),
  restartRecovery: z.literal(true),
  truthfulTerminal: TerminalSchema
}).strict();

export const AcceptanceFixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(20),
  template: z.string().min(1),
  objective: z.string().min(10),
  startsBroken: z.literal(true),
  oneUserRequest: z.literal(true),
  evidenceInvestigation: z.literal(true),
  modelPolicy: z.enum(['real_coding_model', 'guardrail_only']),
  assertions: CommonAssertionsSchema,
  interruptionPoints: z.array(z.enum(['inspection', 'write', 'verification', 'correction'])).optional(),
  attackSurfaces: z.array(z.enum([
    'source', 'project_brain', 'command_output', 'web_content', 'scope_escape',
    'destructive', 'secret_exposure', 'budget_exhaustion', 'infinite_loop'
  ])).optional()
}).strict().superRefine((fixture, context) => {
  if (fixture.id === 'interrupt-every-stage') {
    const required = ['inspection', 'write', 'verification', 'correction'];
    if (JSON.stringify(fixture.interruptionPoints) !== JSON.stringify(required)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'All four interruption points are mandatory.' });
    }
  }

});

export const AcceptanceManifestSchema = z.object({
  schemaVersion: z.literal(2),
  cleanMachineRunsRequired: z.number().int().min(2),
  manualActionsAfterRequest: z.literal(0),
  fixtures: z.array(AcceptanceFixtureSchema).length(10)
}).strict();

export type AcceptanceManifest = z.infer<typeof AcceptanceManifestSchema>;
