import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyBucket } from "@/lib/types";

export async function getCompanyBuckets(
  organizationId: string,
): Promise<CompanyBucket[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_buckets")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch company buckets: ${error.message}`);
  return (data ?? []) as CompanyBucket[];
}

export async function createCompanyBucket(
  organizationId: string,
  name: string,
): Promise<CompanyBucket> {
  const supabase = createAdminClient();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Bucket name is required");
  }

  const { data: existing } = await supabase
    .from("company_buckets")
    .select("bucket_id")
    .eq("organization_id", organizationId);

  const sortOrder = existing?.length ?? 0;
  const { data, error } = await supabase
    .from("company_buckets")
    .insert({
      organization_id: organizationId,
      name: trimmedName,
      sort_order: sortOrder,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A bucket named "${trimmedName}" already exists.`);
    }
    throw new Error(`Failed to create bucket: ${error.message}`);
  }

  return data as CompanyBucket;
}

export async function updateCompanyBucket(
  organizationId: string,
  bucketId: string,
  name: string,
): Promise<CompanyBucket> {
  const supabase = createAdminClient();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Bucket name is required");
  }

  const { data, error } = await supabase
    .from("company_buckets")
    .update({
      name: trimmedName,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("bucket_id", bucketId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(`A bucket named "${trimmedName}" already exists.`);
    }
    throw new Error(`Failed to update bucket: ${error.message}`);
  }

  return data as CompanyBucket;
}

export async function deleteCompanyBucket(
  organizationId: string,
  bucketId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("company_buckets")
    .delete()
    .eq("organization_id", organizationId)
    .eq("bucket_id", bucketId);

  if (error) throw new Error(`Failed to delete bucket: ${error.message}`);
}

export async function setTrackedCompanyBucket(
  organizationId: string,
  companyId: string,
  bucketId: string | null,
): Promise<void> {
  const supabase = createAdminClient();

  if (bucketId) {
    const { data: bucket, error: bucketError } = await supabase
      .from("company_buckets")
      .select("bucket_id")
      .eq("organization_id", organizationId)
      .eq("bucket_id", bucketId)
      .maybeSingle();

    if (bucketError) {
      throw new Error(`Failed to validate bucket: ${bucketError.message}`);
    }
    if (!bucket) {
      throw new Error("Bucket not found");
    }
  }

  const { error } = await supabase
    .from("organization_tracked_companies")
    .update({ bucket_id: bucketId })
    .eq("organization_id", organizationId)
    .eq("company_id", companyId);

  if (error) {
    throw new Error(`Failed to update tracked company bucket: ${error.message}`);
  }
}
