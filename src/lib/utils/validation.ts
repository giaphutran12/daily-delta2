import { z } from 'zod';

// ---------- Company ----------

export const AddCompanyRequestSchema = z.object({
  website_url: z.string().url('Invalid URL'),
  page_title: z.string().optional(),
});

export type AddCompanyRequest = z.infer<typeof AddCompanyRequestSchema>;

export const CompanyBucketCreateSchema = z.object({
  name: z.string().trim().min(1, "Bucket name required").max(60, "Bucket name too long"),
});

export type CompanyBucketCreate = z.infer<typeof CompanyBucketCreateSchema>;

export const CompanyBucketUpdateSchema = z.object({
  name: z.string().trim().min(1, "Bucket name required").max(60, "Bucket name too long"),
});

export type CompanyBucketUpdate = z.infer<typeof CompanyBucketUpdateSchema>;

export const CompanyBucketAssignmentSchema = z.object({
  bucket_id: z.string().uuid().nullable(),
});

export type CompanyBucketAssignment = z.infer<typeof CompanyBucketAssignmentSchema>;

// ---------- Signal Definition ----------

export const SignalDefinitionCreateSchema = z.object({
  name: z.string().min(1, 'Name required'),
  signal_type: z.string().min(1, 'Signal type required'),
  display_name: z.string().min(1, 'Display name required'),
  target_url: z.string().min(1, 'Target URL required'),
  search_instructions: z.string().min(1, 'Search instructions required'),
  company_id: z.string().min(1, 'Company ID required'),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export type SignalDefinitionCreate = z.infer<typeof SignalDefinitionCreateSchema>;

export const SignalDefinitionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  signal_type: z.string().min(1).optional(),
  display_name: z.string().min(1).optional(),
  target_url: z.string().min(1).optional(),
  search_instructions: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export type SignalDefinitionUpdate = z.infer<typeof SignalDefinitionUpdateSchema>;

// ---------- Catalog Search ----------

export const CatalogSearchSchema = z.object({
  q: z.string().optional(),
  industry: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CatalogSearch = z.infer<typeof CatalogSearchSchema>;

// ---------- User Settings ----------

export const SetEmailRequestSchema = z.object({
  email: z.string().email('Invalid email'),
});

export type SetEmailRequest = z.infer<typeof SetEmailRequestSchema>;

export const SetEmailFrequencyRequestSchema = z.object({
  frequency: z.enum(['daily', 'every_3_days', 'weekly', 'monthly']),
});

export type SetEmailFrequencyRequest = z.infer<typeof SetEmailFrequencyRequestSchema>;
