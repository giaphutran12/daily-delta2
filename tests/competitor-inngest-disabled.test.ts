import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  addCompanyToPlatform: vi.fn(),
  addCompetitor: vi.fn(),
  getCompanyById: vi.fn(),
  isTracking: vi.fn(),
  runDiscoveryAgent: vi.fn(),
  trackCompany: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/app/api/_lib/with-auth", () => ({
  withOrg:
    (handler: (request: NextRequest, context: object) => Promise<Response>) =>
    (request: NextRequest) =>
      handler(request, {
        organizationId: "org-1",
        userId: "user-1",
        userEmail: "user@example.com",
      }),
}));

vi.mock("@/services/company-service", () => ({
  addCompanyToPlatform: mocks.addCompanyToPlatform,
  getCompanyById: mocks.getCompanyById,
  isTracking: mocks.isTracking,
  setCompanyPlatformStatus: vi.fn(),
  trackCompany: mocks.trackCompany,
  updateCompanyFromDiscovery: vi.fn(),
}));

vi.mock("@/services/competitor-service", () => ({
  addCompetitor: mocks.addCompetitor,
  getCompetitorSuggestions: vi.fn(),
  getCompetitors: vi.fn(),
  removeCompetitor: vi.fn(),
}));

vi.mock("@/services/pipeline-request-service", () => ({
  enqueuePipelineRequestedEvent: vi.fn(),
}));

vi.mock("@/services/orchestrator", () => ({
  runDiscoveryAgent: mocks.runDiscoveryAgent,
}));

import { POST } from "@/app/api/companies/[id]/competitors/route";

const parentCompany = {
  company_id: "parent-1",
  website_url: "https://parent.example",
};

const competitorCompany = {
  company_id: "competitor-1",
  website_url: "https://competitor.example",
  last_agent_run: null,
};

describe("competitor refreshes while Inngest is disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTracking.mockResolvedValue(true);
    mocks.trackCompany.mockResolvedValue(undefined);
    mocks.addCompetitor.mockResolvedValue(undefined);
  });

  it.each([
    {
      name: "a stale existing competitor",
      body: { competitor_company_id: competitorCompany.company_id },
      arrange: () => {
        mocks.getCompanyById
          .mockResolvedValueOnce(parentCompany)
          .mockResolvedValueOnce(competitorCompany);
      },
    },
    {
      name: "a newly discovered competitor",
      body: { website_url: competitorCompany.website_url },
      arrange: () => {
        mocks.getCompanyById.mockResolvedValueOnce(parentCompany);
        mocks.addCompanyToPlatform.mockResolvedValue({
          company: competitorCompany,
          already_existed: false,
        });
      },
    },
  ])("does not schedule background work for $name", async ({ body, arrange }) => {
    arrange();

    const response = await POST(
      new NextRequest("http://localhost/api/companies/parent-1/competitors", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      refreshQueued: false,
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runDiscoveryAgent).not.toHaveBeenCalled();
  });
});
