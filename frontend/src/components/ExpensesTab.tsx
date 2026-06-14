import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { formatINR, formatDate, splitTypeLabel, splitTypeBadgeClass, getInitials } from '../lib/utils';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Member { userId: number; name: string; joinedAt: string; leftAt?: string; }
interface Expense {
  id: number;
  description: string;
  amount: string;
  originalAmount?: string;
  originalCurrency?: string;
  exchangeRate?: string;
  expenseDate: string;
  splitType: string;
  status: string;
  notes?: string;
  importRow?: number;
  paidBy?: number;
  paidByName?: string;
}
interface Participant {
  id: number;
  userId?: number;
  guestId?: number;
  shareValue: string;
  calculatedAmount: string;
  userName?: string;
}

interface Props { groupId: number; members: Member[]; currentUserId?: number; }

const SPLIT_TYPES = ['equal', 'exact', 'percentage', 'ratio'];

export default function ExpensesTab({ groupId, members, currentUserId }: Props) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, Participant[]>>({});

  // Form state
  const [form, setForm] = useState({
    description: '', paidBy: '', amount: '', expenseDate: new Date().toISOString().split('T')[0],
    splitType: 'equal', notes: '', originalCurrency: 'INR', exchangeRate: '84',
  });
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [shareValues, setShareValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadExpenses(); }, [groupId]);

  async function loadExpenses() {
    try {
      const res = await api.get(`/api/groups/${groupId}/expenses`);
      setExpenses(res.data.expenses);
    } catch { toast.error('Failed to load expenses'); }
    finally { setLoading(false); }
  }

  async function toggleDetail(id: number) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (detail[id]) return;
    try {
      const res = await api.get(`/api/groups/${groupId}/expenses/${id}`);
      setDetail(prev => ({ ...prev, [id]: res.data.participants }));
    } catch { toast.error('Failed to load details'); }
  }

  async function deleteExpense(id: number) {
    if (!confirm('Delete this expense?')) return;
    try {
      await api.delete(`/api/groups/${groupId}/expenses/${id}`);
      toast.success('Expense deleted');
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch { toast.error('Failed to delete'); }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (selectedMembers.length === 0) { toast.error('Select at least one participant'); return; }
    setSaving(true);
    try {
      const amount = parseFloat(form.amount);
      const inrAmount = form.originalCurrency === 'USD'
        ? amount * parseFloat(form.exchangeRate)
        : amount;

      const participants = selectedMembers.map(uid => ({
        userId: uid,
        shareValue: form.splitType !== 'equal' ? parseFloat(shareValues[uid] || '0') : 1,
      }));

      await api.post(`/api/groups/${groupId}/expenses`, {
        description: form.description,
        paidBy: form.paidBy ? parseInt(form.paidBy) : null,
        amount: inrAmount,
        originalAmount: form.originalCurrency !== 'INR' ? amount : undefined,
        originalCurrency: form.originalCurrency,
        exchangeRate: parseFloat(form.exchangeRate),
        expenseDate: form.expenseDate,
        splitType: form.splitType,
        participants,
        notes: form.notes,
      });
      toast.success('Expense added!');
      setShowAdd(false);
      setSelectedMembers([]);
      setShareValues({});
      setForm({ description: '', paidBy: '', amount: '', expenseDate: new Date().toISOString().split('T')[0], splitType: 'equal', notes: '', originalCurrency: 'INR', exchangeRate: '84' });
      loadExpenses();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add expense');
    } finally { setSaving(false); }
  }

  const activeMembers = members.filter(m => !m.leftAt);

  const shareLabel = (type: string) => ({ equal: '', exact: 'Amount (₹)', percentage: 'Share (%)', ratio: 'Ratio' }[type] || '');

  return (
    <div className="fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold">All Expenses ({expenses.length})</h2>
        <button id="add-expense-btn" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add Expense
        </button>
      </div>

      {/* Add expense modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="text-xl font-bold mb-6">Add Expense</h2>
            <form onSubmit={addExpense} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input id="expense-desc" className="form-input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Groceries BigBasket" required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input id="expense-amount" className="form-input" type="number" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="2340" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select id="expense-currency" className="form-input form-select" value={form.originalCurrency} onChange={e => setForm(p => ({ ...p, originalCurrency: e.target.value }))}>
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>
              {form.originalCurrency === 'USD' && (
                <div className="form-group">
                  <label className="form-label">Exchange Rate (₹ per $1)</label>
                  <input id="expense-rate" className="form-input" type="number" step="0.01" value={form.exchangeRate} onChange={e => setForm(p => ({ ...p, exchangeRate: e.target.value }))} />
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Paid By</label>
                  <select id="expense-payer" className="form-input form-select" value={form.paidBy} onChange={e => setForm(p => ({ ...p, paidBy: e.target.value }))}>
                    <option value="">Select payer</option>
                    {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input id="expense-date" className="form-input" type="date" value={form.expenseDate} onChange={e => setForm(p => ({ ...p, expenseDate: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Split Type</label>
                <select id="expense-split-type" className="form-input form-select" value={form.splitType} onChange={e => setForm(p => ({ ...p, splitType: e.target.value }))}>
                  {SPLIT_TYPES.map(t => <option key={t} value={t}>{splitTypeLabel(t)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Split With</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {activeMembers.map(m => (
                    <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <input
                        type="checkbox"
                        id={`member-${m.userId}`}
                        checked={selectedMembers.includes(m.userId)}
                        onChange={e => {
                          if (e.target.checked) setSelectedMembers(prev => [...prev, m.userId]);
                          else { setSelectedMembers(prev => prev.filter(id => id !== m.userId)); setShareValues(prev => { const n = { ...prev }; delete n[m.userId]; return n; }); }
                        }}
                        style={{ accentColor: 'var(--accent-primary)', width: 16, height: 16 }}
                      />
                      <label htmlFor={`member-${m.userId}`} style={{ flex: 1 }}>{m.name}</label>
                      {form.splitType !== 'equal' && selectedMembers.includes(m.userId) && (
                        <input
                          className="form-input"
                          type="number"
                          step="0.01"
                          placeholder={shareLabel(form.splitType)}
                          value={shareValues[m.userId] || ''}
                          onChange={e => setShareValues(prev => ({ ...prev, [m.userId]: e.target.value }))}
                          style={{ width: 120 }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input id="expense-notes" className="form-input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes..." />
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowAdd(false)}>Cancel</button>
                <button id="save-expense-btn" type="submit" className="btn btn-primary w-full" disabled={saving}>
                  {saving ? <span className="spinner" /> : null} Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense list */}
      {loading ? (
        <div className="empty-state"><span className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : expenses.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💳</div>
          <h3 className="font-semibold">No expenses yet</h3>
          <p className="text-muted text-sm">Add an expense or import from CSV</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {expenses.map(exp => (
            <div key={exp.id}>
              <div
                className="card"
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem' }}
                onClick={() => toggleDetail(exp.id)}
                id={`expense-${exp.id}`}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0
                }}>
                  {exp.splitType === 'settlement' ? '✅' : exp.originalCurrency === 'USD' ? '💵' : '💳'}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{exp.description}</span>
                    <span className={`badge ${splitTypeBadgeClass(exp.splitType)}`}>{splitTypeLabel(exp.splitType)}</span>
                    {exp.status === 'pending' && <span className="badge badge-yellow">Pending payer</span>}
                    {exp.importRow && <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>CSV row {exp.importRow}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted mt-1">
                    <span>{formatDate(exp.expenseDate)}</span>
                    {exp.paidByName && <span>Paid by <strong style={{ color: 'var(--text-secondary)' }}>{exp.paidByName}</strong></span>}
                    {exp.originalCurrency && exp.originalCurrency !== 'INR' && (
                      <span className="badge badge-blue">
                        ${exp.originalAmount} @ ₹{parseFloat(exp.exchangeRate || '84').toFixed(0)}/$
                      </span>
                    )}
                  </div>
                  {exp.notes && <div className="text-xs text-muted" style={{ marginTop: 2, fontStyle: 'italic' }}>"{exp.notes}"</div>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-bold text-lg">{formatINR(parseFloat(exp.amount))}</div>
                  {expandedId === exp.id ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                  <button
                    id={`delete-expense-${exp.id}`}
                    className="btn btn-icon btn-ghost"
                    onClick={e => { e.stopPropagation(); deleteExpense(exp.id); }}
                  ><Trash2 size={15} color="var(--red)" /></button>
                </div>
              </div>

              {/* Participant breakdown */}
              {expandedId === exp.id && (
                <div className="card" style={{ borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', borderTop: 'none', marginTop: '-4px', paddingTop: '1rem' }}>
                  {detail[exp.id] ? (
                    <div>
                      <p className="text-xs text-muted mb-3 font-semibold uppercase" style={{ letterSpacing: '0.08em' }}>
                        Split breakdown
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {detail[exp.id].map((p, i) => (
                          <div key={i} className="flex justify-between items-center" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                            <div className="flex items-center gap-2">
                              <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.7rem' }}>
                                {getInitials(p.userName || 'G')}
                              </div>
                              <span className="text-sm">{p.userName || 'Guest'}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {exp.splitType !== 'equal' && (
                                <span className="text-xs text-muted">
                                  ({exp.splitType === 'percentage' ? `${p.shareValue}%` : exp.splitType === 'ratio' ? `ratio ${p.shareValue}` : `exact`})
                                </span>
                              )}
                              <span className="font-semibold">{formatINR(parseFloat(p.calculatedAmount))}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center"><span className="spinner" /></div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
