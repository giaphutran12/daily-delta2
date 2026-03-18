import { z } from 'zod';

// ---------- Company ----------

export const StoreCompanyRequestSchema = z.object({
  website_url: z.string().url('Invalid URL'),
  page_title: z.string().optional(),
});

export type StoreCompanyRequest = z.infer<typeof StoreCompanyRequestSchema>;

// ---------- Run Agents ----------

export const RunAgentsRequestSchema = z.object({
  company_id: z.string().min(1, 'Company ID required'),
});

export type RunAgentsRequest = z.infer<typeof RunAgentsRequestSchema>;

// ---------- Signal Definition ----------

const SignalDefinitionBaseSchema = z.object({
  name: z.string().min(1, 'Name required'),
  signal_type: z.string().min(1, 'Signal type required'),
  display_name: z.string().min(1, 'Display name required'),
  target_url: z.string().url('Invalid URL'),
  search_instructions: z.string().min(1, 'Search instructions required'),
  scope: z.enum(['global', 'company']).default('global'),
  company_id: z.string().nullish(),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const SignalDefinitionCreateSchema = SignalDefinitionBaseSchema.refine(
  (data) => data.scope !== 'company' || (data.company_id != null && data.company_id.length > 0),
  { message: 'company_id is required when scope is company', path: ['company_id'] },
);

export type SignalDefinitionCreate = z.infer<typeof SignalDefinitionCreateSchema>;

export const SignalDefinitionUpdateSchema = SignalDefinitionBaseSchema.partial();

export type SignalDefinitionUpdate = z.infer<typeof SignalDefinitionUpdateSchema>;

// ---------- Stop Run ----------

export const StopRunRequestSchema = z.object({
  company_id: z.string().min(1, 'Company ID required'),
  findings: z.array(
    z.object({
      signal_type: z.string(),
      title: z.string(),
      summary: z.string(),
      source: z.string(),
      url: z.string().optional(),
      detected_at: z.string().optional(),
    })
  ).default([]),
});

export type StopRunRequest = z.infer<typeof StopRunRequestSchema>;

// ---------- User Settings ----------

export const UserSettingsSchema = z.object({
  email: z.string().email('Invalid email'),
  frequency: z.enum(['daily', 'every_3_days', 'weekly', 'monthly']).default('weekly'),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

export const SetEmailRequestSchema = z.object({
  email: z.string().email('Invalid email'),
});

export type SetEmailRequest = z.infer<typeof SetEmailRequestSchema>;

export const SetEmailFrequencyRequestSchema = z.object({
  frequency: z.enum(['daily', 'every_3_days', 'weekly', 'monthly']),
});

export type SetEmailFrequencyRequest = z.infer<typeof SetEmailFrequencyRequestSchema>;
