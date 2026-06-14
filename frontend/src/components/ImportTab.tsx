import React, { useState, useRef } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { anomalySeverityClass, anomalyBadgeClass } from '../lib/utils';
import { Upload, CheckCircle, XCircle, AlertTriangle, Info, Download, FileText } from 'lucide-react';

interface Anomaly {
  id?: number;
  rowNumber: number;
  type: string;
  severity: string;
  description: string;
  rawData?: Record<string, string>;
  autoFixed: boolean;
  autoFixDescription?: string;
  resolution: string;
  suggestedAction?: string;
}

interface ParsedRow {
  rowNumber: number;
  date: string;
  description: string;
  paidByName: string | null;
  amount: number;
  currency: string;
  splitType: string;
  splitWith: string[];
  status: 'ready' | 'pending_review' | 'rejected';
  anomalyTypes: string[];
}

interface ParseSummary {
  totalRows: number;
  readyRows: number;
  pendingReviewRows: number;
  rejectedRows: number;
  anomalyCount: number;
  autoFixedCount: number;
  needsReviewCount: number;
}

type Step = 1 | 2 | 3 | 4 | 5;
interface Props { groupId: number; onComplete: () => void; }

export default function ImportTab({ groupId, onComplete }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usdRate, setUsdRate] = useState('84');
  const [parsing, setParsing] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ importedRows: number; skippedRows: number } | null>(null);
  const [report, setReport] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.csv')) setFile(f);
    else toast.error('Please upload a CSV file');
  }

  async function parseCsv() {
    if (!file) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('usdToInrRate', usdRate);
      const res = await api.post(`/api/groups/${groupId}/import/parse`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSessionId(res.data.sessionId);
      setSummary(res.data.summary);
      setAnomalies(res.data.anomalies);
      setRows(res.data.rows);
      // Initialize resolutions from backend
      const init: Record<number, string> = {};
      res.data.anomalies.forEach((a: Anomaly) => {
        if (a.id) init[a.id] = a.resolution;
      });
      setResolutions(init);
      setStep(2);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to parse CSV');
    } finally {
      setParsing(false);
    }
  }

  // ── Step 3: Resolve anomaly ─────────────────────────────────────────────────
  async function resolveAnomaly(anomalyId: number, resolution: 'approved' | 'rejected') {
    try {
      await api.patch(`/api/groups/${groupId}/import/${sessionId}/anomalies/${anomalyId}`, { resolution });
      setResolutions(prev => ({ ...prev, [anomalyId]: resolution }));
      toast.success(resolution === 'approved' ? 'Approved' : 'Rejected');
    } catch { toast.error('Failed to update'); }
  }

  // ── Step 4: Commit ──────────────────────────────────────────────────────────
  async function commitImport() {
    if (!sessionId) return;
    setCommitting(true);
    try {
      const res = await api.post(`/api/groups/${groupId}/import/${sessionId}/commit`);
      setCommitResult(res.data);
      // Fetch report
      const reportRes = await api.get(`/api/groups/${groupId}/import/${sessionId}/report`);
      setReport(reportRes.data.report);
      setStep(5);
      toast.success(`Import complete! ${res.data.importedRows} expenses imported.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setCommitting(false);
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-report-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const needsReviewAnomalies = anomalies.filter(a => !a.autoFixed && a.resolution !== 'rejected');
  const autoFixedCount = anomalies.filter(a => a.autoFixed).length;
  const pendingCount = needsReviewAnomalies.filter(a => !resolutions[a.id!] || resolutions[a.id!] === 'pending' || resolutions[a.id!] === 'needs_review').length;

  const severityIcon = (s: string) => {
    if (s === 'error') return <XCircle size={14} color="var(--red)" />;
    if (s === 'warning') return <AlertTriangle size={14} color="var(--yellow)" />;
    return <Info size={14} color="var(--blue)" />;
  };

  return (
    <div className="fade-in">
      <h2 className="text-lg font-bold mb-2">Import from CSV</h2>
      <p className="text-sm text-muted mb-6">
        Import <strong>Expenses Export.csv</strong> with full anomaly detection. All 21 known data problems are detected and surfaced for your review.
      </p>

      {/* Step indicator */}
      <div className="step-indicator mb-8">
        {(['Upload', 'Review Anomalies', 'Resolve', 'Confirm', 'Done'] as const).map((label, i) => (
          <React.Fragment key={i}>
            <div className={`step ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
              <div className="step-number">
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span className="text-xs" style={{ display: 'none' }}>{label}</span>
            </div>
            {i < 4 && <div className={`step-line ${step > i + 1 ? 'done' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* ─── STEP 1: Upload ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            id="csv-upload-zone"
          >
            <div className="upload-icon">📄</div>
            <h3 className="font-semibold mb-2">{file ? file.name : 'Drop your CSV here or click to browse'}</h3>
            <p className="text-sm text-muted">{file ? `${(file.size / 1024).toFixed(1)} KB ready to parse` : 'Supports: expenses_export.csv'}</p>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>

          <div className="card mt-6" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2 mb-3">
              <span>💱</span>
              <span className="font-semibold text-sm">USD → INR Exchange Rate</span>
            </div>
            <p className="text-xs text-muted mb-3">
              The CSV contains 4 USD expenses from the Goa trip (March 2026). What exchange rate should we use?
            </p>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold">$1 USD =</span>
              <input
                id="usd-rate-input"
                className="form-input"
                type="number"
                step="0.01"
                value={usdRate}
                onChange={e => setUsdRate(e.target.value)}
                style={{ width: 120 }}
              />
              <span className="text-sm text-muted">₹ INR</span>
            </div>
          </div>

          <button
            id="parse-csv-btn"
            className="btn btn-primary btn-lg w-full mt-6"
            disabled={!file || parsing}
            onClick={parseCsv}
          >
            {parsing ? <span className="spinner" /> : <Upload size={18} />}
            {parsing ? 'Analysing CSV…' : 'Parse & Analyse'}
          </button>
        </div>
      )}

      {/* ─── STEP 2: Anomaly Summary ─────────────────────────────────────────── */}
      {step === 2 && summary && (
        <div>
          <div className="grid-4 mb-8">
            <div className="stat-card">
              <div className="stat-value">{summary.totalRows}</div>
              <div className="stat-label">Total rows</div>
            </div>
            <div className="stat-card">
              <div className="stat-value text-green">{summary.readyRows}</div>
              <div className="stat-label">Ready to import</div>
            </div>
            <div className="stat-card">
              <div className="stat-value text-yellow">{summary.pendingReviewRows}</div>
              <div className="stat-label">Need review</div>
            </div>
            <div className="stat-card">
              <div className="stat-value text-red">{summary.rejectedRows}</div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>

          <div className="card mb-6" style={{ background: 'var(--accent-glow)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: '1.5rem' }}>🔍</span>
              <div>
                <div className="font-bold">{summary.anomalyCount} anomalies detected</div>
                <div className="text-sm text-muted">
                  {summary.autoFixedCount} auto-fixed · {summary.needsReviewCount} need your review
                </div>
              </div>
            </div>
          </div>

          {/* Row status table */}
          <div className="table-wrapper mb-6">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Description</th>
                  <th>Date</th>
                  <th>Paid By</th>
                  <th>Amount</th>
                  <th>Issues</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.rowNumber} id={`import-row-${r.rowNumber}`}>
                    <td className="text-xs text-muted">{r.rowNumber}</td>
                    <td style={{ maxWidth: 200 }} className="truncate">{r.description}</td>
                    <td className="text-xs">{r.date}</td>
                    <td className="text-xs">{r.paidByName || <span className="text-muted">—</span>}</td>
                    <td>{r.currency === 'USD' ? `$${r.amount}` : `₹${r.amount.toFixed(2)}`}</td>
                    <td>
                      {r.anomalyTypes.length > 0 ? (
                        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                          {r.anomalyTypes.slice(0, 2).map(t => (
                            <span key={t} className="badge badge-yellow" style={{ fontSize: '0.6rem' }}>{t}</span>
                          ))}
                          {r.anomalyTypes.length > 2 && <span className="badge badge-gray" style={{ fontSize: '0.6rem' }}>+{r.anomalyTypes.length - 2}</span>}
                        </div>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td>
                      <span className={`badge ${r.status === 'ready' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-yellow'}`}>
                        {r.status === 'ready' ? '✓ Ready' : r.status === 'rejected' ? '✗ Rejected' : '⚠ Review'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button id="review-anomalies-btn" className="btn btn-primary w-full" onClick={() => setStep(3)}>
              Review {needsReviewAnomalies.length} Anomalies →
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: Anomaly Resolution (Meera's requirement) ─────────────────── */}
      {step === 3 && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="font-bold">Review Anomalies</h3>
              <p className="text-sm text-muted">{pendingCount} still need your decision</p>
            </div>
            <div className="flex gap-2">
              <span className="badge badge-green">{autoFixedCount} auto-fixed</span>
              <span className="badge badge-yellow">{needsReviewAnomalies.length} flagged</span>
            </div>
          </div>

          {/* Auto-fixed (collapsed group) */}
          {autoFixedCount > 0 && (
            <div className="card mb-4" style={{ opacity: 0.7 }}>
              <div className="flex items-center gap-2">
                <CheckCircle size={16} color="var(--green)" />
                <span className="font-semibold text-sm">{autoFixedCount} issues auto-fixed</span>
                <span className="text-xs text-muted">(name normalization, comma amounts, date formats, missing currency defaults)</span>
              </div>
            </div>
          )}

          {/* Needs review */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
            {needsReviewAnomalies.map((a) => {
              const resolved = resolutions[a.id!];
              const isApproved = resolved === 'approved';
              const isRejected = resolved === 'rejected';
              return (
                <div
                  key={a.id}
                  className={`card ${anomalySeverityClass(a.severity)}`}
                  id={`anomaly-${a.id}`}
                  style={{ opacity: (isApproved || isRejected) ? 0.7 : 1 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-2 mb-1">
                        {severityIcon(a.severity)}
                        <span className={`badge ${anomalyBadgeClass(a.severity)}`}>{a.type}</span>
                        <span className="text-xs text-muted">Row {a.rowNumber}</span>
                        {(isApproved || isRejected) && (
                          <span className={`badge ${isApproved ? 'badge-green' : 'badge-red'}`}>
                            {isApproved ? '✓ Approved' : '✗ Rejected'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm" style={{ lineHeight: 1.6 }}>{a.description}</p>
                      {a.suggestedAction && (
                        <p className="text-xs text-accent mt-2">
                          💡 <em>{a.suggestedAction}</em>
                        </p>
                      )}
                    </div>
                    {a.id && !a.autoFixed && (
                      <div className="flex gap-2" style={{ flexShrink: 0 }}>
                        <button
                          id={`approve-anomaly-${a.id}`}
                          className={`btn btn-sm ${isApproved ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => resolveAnomaly(a.id!, 'approved')}
                        >
                          <CheckCircle size={13} /> Approve
                        </button>
                        <button
                          id={`reject-anomaly-${a.id}`}
                          className={`btn btn-sm ${isRejected ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => resolveAnomaly(a.id!, 'rejected')}
                        >
                          <XCircle size={13} /> Reject row
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
            <button id="proceed-to-import-btn" className="btn btn-primary w-full" onClick={() => setStep(4)}>
              Proceed to Import ({rows.filter(r => r.status !== 'rejected').length} rows) →
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: Confirm & Commit ─────────────────────────────────────────── */}
      {step === 4 && (
        <div>
          <div className="card mb-6" style={{ background: 'var(--bg-secondary)', textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚀</div>
            <h3 className="text-xl font-bold mb-2">Ready to import</h3>
            <p className="text-muted text-sm mb-4">
              This will create expenses from all approved rows. Rejected rows will be skipped.
              This action can be undone by deleting individual expenses.
            </p>
            <div className="flex justify-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green">{rows.filter(r => r.status !== 'rejected').length}</div>
                <div className="text-xs text-muted">To import</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red">{rows.filter(r => r.status === 'rejected').length}</div>
                <div className="text-xs text-muted">Skipped</div>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary" onClick={() => setStep(3)}>← Review Again</button>
            <button id="commit-import-btn" className="btn btn-primary btn-lg w-full" disabled={committing} onClick={commitImport}>
              {committing ? <span className="spinner" /> : '✓'} Complete Import
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 5: Done + Report ────────────────────────────────────────────── */}
      {step === 5 && commitResult && (
        <div className="fade-in">
          <div className="card mb-6" style={{ background: 'var(--green-bg)', border: '1px solid rgba(16,185,129,0.3)', textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
            <h3 className="text-xl font-bold mb-2 text-green">Import Complete!</h3>
            <div className="flex justify-center gap-6 mt-4">
              <div>
                <div className="text-2xl font-bold text-green">{commitResult.importedRows}</div>
                <div className="text-xs text-muted">Expenses imported</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-muted">{commitResult.skippedRows}</div>
                <div className="text-xs text-muted">Rows skipped</div>
              </div>
            </div>
          </div>

          {/* Anomaly report */}
          {report && (
            <div className="card mb-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <FileText size={16} />
                  <span className="font-bold">Import Report</span>
                </div>
                <button id="download-report-btn" className="btn btn-secondary btn-sm" onClick={downloadReport}>
                  <Download size={14} /> Download JSON
                </button>
              </div>
              <div className="grid-3 mb-4">
                <div style={{ textAlign: 'center' }}>
                  <div className="text-lg font-bold text-green">{report.summary.autoFixed}</div>
                  <div className="text-xs text-muted">Auto-fixed</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="text-lg font-bold text-accent">{report.summary.approvedByUser}</div>
                  <div className="text-xs text-muted">Approved by you</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="text-lg font-bold text-red">{report.summary.rejectedByUser}</div>
                  <div className="text-xs text-muted">Rejected</div>
                </div>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {report.anomalies.map((a: any, i: number) => (
                  <div key={i} className="text-xs" style={{
                    padding: '0.5rem',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start'
                  }}>
                    <span className={`badge ${anomalyBadgeClass(a.severity)}`} style={{ flexShrink: 0 }}>Row {a.row}</span>
                    <span className="badge badge-gray" style={{ flexShrink: 0 }}>{a.type}</span>
                    <span className="text-muted">{a.description}</span>
                    <span className={`badge ${a.autoFixed ? 'badge-green' : a.resolution === 'approved' ? 'badge-blue' : 'badge-red'}`} style={{ flexShrink: 0 }}>
                      {a.autoFixed ? 'auto-fixed' : a.resolution}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button id="go-to-expenses-btn" className="btn btn-primary w-full" onClick={onComplete}>
              View Expenses →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
