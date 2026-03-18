import { Resend } from "resend";
import { ReportData, Company, normalizeReportData } from "@/lib/types";

function csvEscape(value: string): string {
  let safe = value;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildReportCSV(rawReport: ReportData): string {
  const report = normalizeReportData(rawReport);
  const rows: string[] = [];

  rows.push("Section,Title,Summary,Source,URL,Detected At");

  for (const section of report.sections) {
    for (const item of section.items) {
      rows.push(
        [
          csvEscape(section.display_name),
          csvEscape(item.title),
          csvEscape(item.summary),
          csvEscape(item.source),
          csvEscape(item.url || ""),
          csvEscape(item.detected_at || new Date().toISOString()),
        ].join(","),
      );
    }
  }

  if (rows.length === 1) {
    rows.push("No signals detected,,,,");
  }

  return rows.join("\n");
}

function renderAiSummaryHtml(summary: string, summaryType?: string): string {
  const mono = "'Courier New',Courier,monospace";
  const serif = "Georgia,'Times New Roman',serif";

  const sectionTitle =
    summaryType === "business_intelligence"
      ? "Business Intelligence Analysis"
      : "Executive Summary";

  const bodyHtml = summary
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "<br/>";
      if (t.startsWith("###"))
        return (
          '<h4 style="margin:12px 0 4px;font-family:' +
          serif +
          ';font-size:15px;color:#1a1a1a;">' +
          t.replace(/^###\s*/, "").replace(/\*\*/g, "") +
          "</h4>"
        );
      if (t.startsWith("##"))
        return (
          '<h3 style="margin:14px 0 4px;font-family:' +
          serif +
          ';font-size:16px;color:#1a1a1a;">' +
          t.replace(/^##\s*/, "").replace(/\*\*/g, "") +
          "</h3>"
        );
      if (t.startsWith("#"))
        return (
          '<h3 style="margin:14px 0 4px;font-family:' +
          serif +
          ';font-size:17px;color:#1a1a1a;">' +
          t.replace(/^#\s*/, "").replace(/\*\*/g, "") +
          "</h3>"
        );
      if (t.startsWith("**") && t.endsWith("**"))
        return (
          '<h4 style="margin:12px 0 4px;font-family:' +
          serif +
          ';font-size:15px;color:#1a1a1a;">' +
          t.replace(/\*\*/g, "") +
          "</h4>"
        );
      const rendered = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      if (/^[-*]\s/.test(t))
        return (
          '<p style="margin:2px 0;padding-left:16px;font-family:' +
          serif +
          ';font-size:14px;line-height:1.55;color:#333;">&bull; ' +
          rendered.replace(/^[-*]\s+/, "") +
          "</p>"
        );
      return (
        '<p style="margin:4px 0;font-family:' +
        serif +
        ';font-size:14px;line-height:1.55;color:#333;">' +
        rendered +
        "</p>"
      );
    })
    .join("\n");

  return `
              <tr>
                <td style="padding:28px 40px 0;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                    <tr>
                      <td style="padding-bottom:10px;border-bottom:1px solid #1a1a1a;">
                        <span style="font-family:${mono};font-size:10px;letter-spacing:1px;color:#999;text-transform:uppercase;">SEC_00</span>
                        <h2 style="margin:4px 0 0;font-family:${serif};font-size:18px;font-weight:normal;color:#1a1a1a;letter-spacing:-0.3px;">
                          ${sectionTitle}
                        </h2>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:12px 0;font-family:${serif};font-size:14px;line-height:1.65;color:#333;">
                        ${bodyHtml}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 40px;">
                  <div style="border-top:1px solid #1a1a1a;"></div>
                </td>
              </tr>`;
}

export function buildReportEmail(
  company: Company,
  rawReport: ReportData,
): string {
  const report = normalizeReportData(rawReport);
  const mono = "'Courier New',Courier,monospace";
  const serif = "Georgia,'Times New Roman',serif";

  const sectionsHtml = report.sections
    .filter((s) => s.items.length > 0)
    .map((section, idx) => {
      const sectionKey = String(idx + 1).padStart(2, "0");
      const entries = section.items
        .map((item) => {
          const sourceLink = item.url
            ? `<a href="${item.url}" style="color:#1342FF;text-decoration:none;font-family:${mono};font-size:11px;">[${item.source}]</a>`
            : "";
          const dateStr = item.detected_at
            ? new Date(item.detected_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "";
          return `
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #e8e8e8;vertical-align:top;">
                <p style="margin:0;font-family:${serif};font-size:14px;line-height:1.6;color:#1a1a1a;">
                  <strong>${item.title}</strong> ${sourceLink}
                </p>
                <p style="margin:6px 0 0;font-family:${serif};font-size:13px;line-height:1.55;color:#4a4a4a;">
                  ${item.summary}
                </p>
                <p style="margin:4px 0 0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">
                  via ${item.source}${dateStr ? ` &middot; ${dateStr}` : ""}
                </p>
              </td>
            </tr>`;
        })
        .join("");

      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
          <tr>
            <td style="padding-bottom:10px;border-bottom:1px solid #1a1a1a;">
              <span style="font-family:${mono};font-size:10px;letter-spacing:1px;color:#999;text-transform:uppercase;">SEC_${sectionKey}</span>
              <h2 style="margin:4px 0 0;font-family:${serif};font-size:18px;font-weight:normal;color:#1a1a1a;letter-spacing:-0.3px;">
                ${section.display_name}
              </h2>
            </td>
          </tr>
          ${entries}
        </table>`;
    })
    .join("");

  const noSignals =
    sectionsHtml.length === 0
      ? `<p style="font-family:${serif};font-size:14px;color:#999;text-align:center;padding:40px 0;">No new signals detected in this cycle.</p>`
      : "";

  const now = new Date();
  const dateFormatted = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatted = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:960px;background:#ffffff;border:1px solid #e0e0e0;">

              <!-- Header title block -->
              <tr>
                <td style="padding:48px 40px 0;">
                  <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:2px;color:#999;text-transform:uppercase;">
                    Daily Delta
                  </p>
                  <h1 style="margin:8px 0 0;font-family:${serif};font-size:28px;font-weight:normal;color:#1a1a1a;letter-spacing:-0.5px;line-height:1.2;">
                    Signal Intelligence Report
                  </h1>
                  <p style="margin:12px 0 0;font-family:${mono};font-size:11px;letter-spacing:0.5px;color:#666;text-transform:uppercase;">
                    ${company.company_name}
                  </p>
                </td>
              </tr>

              <!-- Divider -->
              <tr>
                <td style="padding:20px 40px 0;">
                  <p style="margin:0;font-family:${mono};font-size:10px;color:#ccc;letter-spacing:2px;">
                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                  </p>
                </td>
              </tr>

              <!-- Metadata block -->
              <tr>
                <td style="padding:20px 40px 0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="50%" style="vertical-align:top;">
                        <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">Date</p>
                        <p style="margin:2px 0 0;font-family:${serif};font-size:13px;color:#1a1a1a;">${dateFormatted}</p>
                      </td>
                      <td width="50%" style="vertical-align:top;">
                        <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">Time</p>
                        <p style="margin:2px 0 0;font-family:${serif};font-size:13px;color:#1a1a1a;">${timeFormatted}</p>
                      </td>
                    </tr>
                    <tr>
                      <td width="50%" style="vertical-align:top;padding-top:12px;">
                        <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">Website</p>
                        <p style="margin:2px 0 0;font-family:${mono};font-size:12px;">
                          <a href="${company.website_url}" style="color:#1342FF;text-decoration:none;">${company.website_url}</a>
                        </p>
                      </td>
                      <td width="50%" style="vertical-align:top;padding-top:12px;">
                        ${
                          company.industry
                            ? `
                        <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">Industry</p>
                        <p style="margin:2px 0 0;font-family:${serif};font-size:13px;color:#1a1a1a;">${company.industry}</p>
                        `
                            : ""
                        }
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Company overview -->
              <tr>
                <td style="padding:28px 40px 0;">
                  <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;">Company Overview</p>
                  <p style="margin:8px 0 0;font-family:${serif};font-size:14px;line-height:1.65;color:#333;">
                    ${report.company_overview}
                  </p>
                </td>
              </tr>

              <!-- Divider -->
              <tr>
                <td style="padding:28px 40px 0;">
                  <div style="border-top:1px solid #1a1a1a;"></div>
                </td>
              </tr>

              <!-- AI Summary / Business Intelligence -->
              ${report.ai_summary ? renderAiSummaryHtml(report.ai_summary, report.ai_summary_type) : ""}

              <!-- Sections -->
              <tr>
                <td style="padding:28px 40px 0;">
                  ${sectionsHtml}
                  ${noSignals}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:12px 40px 48px;">
                  <p style="margin:0;font-family:${mono};font-size:10px;color:#ccc;letter-spacing:2px;">
                    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                  </p>
                  <p style="margin:16px 0 0;font-family:${mono};font-size:10px;letter-spacing:0.5px;color:#999;text-transform:uppercase;text-align:center;">
                    Daily Delta &mdash; Automated Intelligence Report
                  </p>
                  <p style="margin:4px 0 0;font-family:${mono};font-size:10px;color:#bbb;text-align:center;">
                    A CSV file with structured data is attached to this email.
                  </p>
                  <p style="margin:16px 0 0;font-family:${mono};font-size:10px;text-align:center;color:#ccc;">
                    ╌╌ END ╌╌
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export async function sendReportEmail(
  toEmail: string,
  company: Company,
  report: ReportData,
): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY must be configured");

    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "signals@dailydelta.com";
    console.log(
      `[Email] Building email for ${company.company_name} — ai_summary present: ${!!report.ai_summary}, type: ${report.ai_summary_type || "none"}`,
    );
    const html = buildReportEmail(company, report);
    const csv = buildReportCSV(report);

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const subject = `Report of ${company.company_name}, ${dateStr} ${timeStr}`;

    const safeCompanyName = company.company_name.replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const fileDate = now.toISOString().slice(0, 10);

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: `Daily Delta <${fromEmail}>`,
      to: [toEmail],
      subject,
      html,
      attachments: [
        {
          filename: `${safeCompanyName}_report_${fileDate}.csv`,
          content: Buffer.from(csv).toString("base64"),
        },
      ],
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(
      `[Email] Report sent to ${toEmail} for ${company.company_name} (id: ${data?.id})`,
    );
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send report:`, err);
    return false;
  }
}

export async function sendInviteEmail(
  toEmail: string,
  orgName: string,
  inviterEmail: string,
  role: string,
  acceptToken: string,
): Promise<boolean> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY must be configured");

    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "signals@dailydelta.com";
    const frontendUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const acceptUrl = `${frontendUrl}/invite/accept?token=${acceptToken}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:Georgia,'PT Serif',serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
              <tr>
                <td style="background:#1342FF;padding:24px 32px;">
                  <h1 style="margin:0;font-size:20px;color:#fff;font-weight:600;">Daily Delta</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <h2 style="margin:0 0 16px;font-size:18px;color:#111;">You've been invited!</h2>
                  <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 16px;">
                    <strong>${inviterEmail}</strong> has invited you to join
                    <strong>${orgName}</strong> as ${role === "admin" ? "an" : "a"} <strong>${role}</strong>
                    on Daily Delta.
                  </p>
                  <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
                    Daily Delta is a startup intelligence platform that helps VC teams track companies
                    and receive automated intelligence reports.
                  </p>
                  <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                    <tr>
                      <td style="background:#1342FF;border-radius:6px;">
                        <a href="${acceptUrl}" target="_blank" style="display:inline-block;padding:12px 32px;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">
                          Accept Invitation
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="font-size:12px;color:#999;margin:24px 0 0;text-align:center;">
                    This invitation expires in 7 days. If you don't have an account yet,
                    sign up first and then click the link above.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: `Daily Delta <${fromEmail}>`,
      to: [toEmail],
      subject: `You're invited to ${orgName} on Daily Delta`,
      html,
    });

    if (error) {
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(
      `[Email] Invite sent to ${toEmail} for org ${orgName} (id: ${data?.id})`,
    );
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send invite:`, err);
    return false;
  }
}
