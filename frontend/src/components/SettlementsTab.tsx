import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { formatINR, formatDate, getInitials } from '../lib/utils';
import { Plus, ArrowRight, Trash2 } from 'lucide-react';

interface Member { userId: number; name: string; joinedAt: string; leftAt?: string; }
interface Settlement {
  id: number;
  paidBy: number;
  paidTo: number;
  amount: string;
  settledAt: string;
  notes?: string;
  paidByName: string;
}
interface Props { groupId: number; members: Member[]; }

export default function SettlementsTab({ groupId, members }: Props) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    paidBy: '', paidTo: '', amount: '',
    settledAt: new Date().toISOString().split('T')[0], notes: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [groupId]);

  async function load() {
    try {
      const res = await api.get(`/api/groups/${groupId}/settlements`);
      setSettlements(res.data.settlements);
    } catch { toast.error('Failed to load settlements'); }
    finally { setLoading(false); }
  }

  async function addSettlement(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/groups/${groupId}/settlements`, {
        paidBy: parseInt(form.paidBy),
        paidTo: parseInt(form.paidTo),
        amount: parseFloat(form.amount),
        settledAt: form.settledAt,
        notes: form.notes,
      });
      toast.success('Settlement recorded!');
      setShowAdd(false);
      setForm({ paidBy: '', paidTo: '', amount: '', settledAt: new Date().toISOString().split('T')[0], notes: '' });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to record settlement');
    } finally { setSaving(false); }
  }

  async function deleteSettlement(id: number) {
    if (!confirm('Delete this settlement?')) return;
    try {
      await api.delete(`/api/groups/${groupId}/settlements/${id}`);
      toast.success('Deleted');
      setSettlements(prev => prev.filter(s => s.id !== id));
    } catch { toast.error('Failed to delete'); }
  }

  // Get name from userId
  const getName = (id: number) => members.find(m => m.userId === id)?.name || `User #${id}`;

  return (
    <div className="fade-in">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold">Settlements</h2>
          <p className="text-sm text-muted mt-1">Record payments made between members to clear debts</p>
        </div>
        <button id="record-settlement-btn" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Record Payment
        </button>
      </div>

      {/* Add settlement modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '440px' }}>
            <h2 className="text-xl font-bold mb-6">Record Payment</h2>
            <form onSubmit={addSettlement} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Who paid?</label>
                <select id="settlement-from" className="form-input form-select" value={form.paidBy} onChange={e => setForm(p => ({ ...p, paidBy: e.target.value }))} required>
                  <option value="">Select payer</option>
                  {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Paid to</label>
                <select id="settlement-to" className="form-input form-select" value={form.paidTo} onChange={e => setForm(p => ({ ...p, paidTo: e.target.value }))} required>
                  <option value="">Select recipient</option>
                  {members.filter(m => m.userId !== parseInt(form.paidBy)).map(m => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Amount (₹)</label>
                  <input id="settlement-amount" className="form-input" type="number" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input id="settlement-date" className="form-input" type="date" value={form.settledAt} onChange={e => setForm(p => ({ ...p, settledAt: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes (optional)</label>
                <input id="settlement-notes" className="form-input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="UPI transfer, cash, etc." />
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowAdd(false)}>Cancel</button>
                <button id="save-settlement-btn" type="submit" className="btn btn-success w-full" disabled={saving}>
                  {saving ? <span className="spinner" /> : null} Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settlements list */}
      {loading ? (
        <div className="empty-state"><span className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : settlements.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <h3 className="font-semibold">No settlements recorded</h3>
          <p className="text-muted text-sm">Use "Record Payment" when someone pays another member directly</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {settlements.map(s => (
            <div key={s.id} className="transaction-card" id={`settlement-${s.id}`}>
              <div className="avatar">{getInitials(getName(s.paidBy))}</div>
              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{getName(s.paidBy)}</span>
                  <ArrowRight size={14} color="var(--text-muted)" />
                  <span className="font-semibold">{getName(s.paidTo)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted mt-1">
                  <span>{formatDate(s.settledAt)}</span>
                  {s.notes && <span>· {s.notes}</span>}
                </div>
              </div>
              <div className="amount-positive text-lg font-bold">{formatINR(parseFloat(s.amount))}</div>
              <button
                id={`delete-settlement-${s.id}`}
                className="btn btn-icon btn-ghost"
                onClick={() => deleteSettlement(s.id)}
              ><Trash2 size={15} color="var(--red)" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
