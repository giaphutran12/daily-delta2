import { useState, useEffect } from 'react';
import { Report, getReports, normalizeReportData, deleteReport } from '../api/client';
import { Markdown } from '../components/Markdown';
import { useAuth } from '../auth/AuthContext';

export function ReportsTab() {
  const { currentOrg } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    setLoading(true);
    getReports()
      .then((r) => setReports(r))
      .catch(() => setError('Failed to load reports'))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this report?')) return;
    await deleteReport(id);
    setReports((prev) => prev.filter((r) => r.report_id !== id));
    if (expanded === id) setExpanded(null);
  };

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-[12px] text-black/40">No organization selected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <span className="w-5 h-5 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-red-600 text-[12px]">{error}</p>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <p className="text-[13px] text-black/40">No reports yet</p>
        <p className="text-[11px] text-black/25">Run agents on a company to generate reports.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4 overflow-y-auto">
      {reports.map((report) => {
        const normalized = normalizeReportData(report.report_data);
        const isOpen = expanded === report.report_id;
        const date = new Date(report.generated_at).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        });

        return (
          <div key={report.report_id} className="bg-white border border-black/8 rounded">
            {/* Header row */}
            <div
              className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none"
              onClick={() => setExpanded(isOpen ? null : report.report_id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-black truncate">
                  {normalized.company_overview?.slice(0, 50) || 'Report'}
                </div>
                <div className="text-[10px] text-black/35 mt-0.5" style={{ fontFamily: "'Departure Mono', monospace" }}>
                  {date} · {normalized.sections.length} signal{normalized.sections.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(report.report_id); }}
                  className="text-black/20 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M2 4l4 4 4-4" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-black/8 px-3 py-3 flex flex-col gap-3">
                {normalized.ai_summary && (
                  <div className="bg-[#F5F5F5] rounded px-2.5 py-2">
                    <div className="text-[9px] font-medium text-black/40 uppercase tracking-widest mb-1.5" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      Summary
                    </div>
                    <Markdown>{normalized.ai_summary}</Markdown>
                  </div>
                )}
                {normalized.sections.map((section) => (
                  <div key={section.signal_type}>
                    <div className="text-[9px] font-medium text-black/40 uppercase tracking-widest mb-1.5" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      {section.display_name}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {section.items.map((item, i) => (
                        <div key={i} className="border border-black/8 rounded px-2.5 py-2">
                          <div className="text-[11px] font-semibold text-black">{item.title}</div>
                          <p className="text-[10px] text-black/55 mt-0.5 leading-relaxed">{item.summary}</p>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-[#1342FF] hover:underline mt-0.5 block truncate"
                            >
                              {item.url}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
