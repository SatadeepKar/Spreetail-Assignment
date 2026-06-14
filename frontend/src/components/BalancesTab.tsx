import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { formatINR, getInitials } from '../lib/utils';
import { ArrowRight, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';

interface Member {
  userId: number;
  name: string;
  joinedAt: string;
  leftAt?: string;
}

interface Balance {
  userId: number;
  name: string;
  net: number;
}

interface Transaction {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  amount: number;
}

interface ExpenseBreakdown {
  expenseId: number;
  description: string;
  date: string;
  paidByName: string | null;
  totalAmount: number;
  splitType: string;
  yourShare: number;
  notes: string | null;
}

interface Props {
  groupId: number;
  members: Member[];
  currentUserId?: number;
}

export default function BalancesTab({ groupId, members, currentUserId }: Props) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<Record<number, ExpenseBreakdown[]>>({});
  const [loadingBreakdown, setLoadingBreakdown] = useState<number | null>(null);

  useEffect(() => {
    loadBalances();
  }, [groupId]);

  async function loadBalances() {
    try {
      const res = await api.get(`/api/groups/${groupId}/balances`);
      setBalances(res.data.balances);
      setTransactions(res.data.transactions);
    } catch {
      toast.error('Failed to load balances');
    } finally {
      setLoading(false);
    }
  }

  async function toggleBreakdown(userId: number) {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    if (breakdown[userId]) return;

    setLoadingBreakdown(userId);
    try {
      const res = await api.get(`/api/groups/${groupId}/balances/${userId}/breakdown`);
      setBreakdown((prev) => ({ ...prev, [userId]: res.data.breakdown }));
    } catch {
      toast.error('Failed to load breakdown');
    } finally {
      setLoadingBreakdown(null);
    }
  }

  if (loading) {
    return <div className="empty-state"><span className="spinner" style={{ width: 32, height: 32 }} /></div>;
  }

  const totalExpenses = balances.reduce((s, b) => s + Math.max(b.net, 0), 0);

  return (
    <div className="fade-in">
      {/* Summary stats */}
      <div className="grid-3 mb-8">
        <div className="stat-card">
          <div className="stat-value text-accent">{balances.length}</div>
          <div className="stat-label">People with balances</div>
        </div>
        <div className="stat-card">
          <div className="stat-value text-green">{formatINR(totalExpenses)}</div>
          <div className="stat-label">Total owed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{transactions.length}</div>
          <div className="stat-label">Settlements needed</div>
        </div>
      </div>

      {/* Who pays whom */}
      {transactions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-4">
            💡 Settle Up — {transactions.length} payment{transactions.length !== 1 ? 's' : ''} to clear all debts
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {transactions.map((t, i) => (
              <div key={i} className="transaction-card">
                <div className="avatar">{getInitials(t.fromName)}</div>
                <div>
                  <span className="font-semibold">{t.fromName}</span>
                  <span className="text-muted text-sm"> pays </span>
                  <span className="font-semibold">{t.toName}</span>
                </div>
                <ArrowRight size={16} color="var(--text-muted)" style={{ margin: '0 0.5rem' }} />
                <div className="amount-positive" style={{ marginLeft: 'auto', fontSize: '1.1rem' }}>
                  {formatINR(t.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-person balances with drill-down */}
      <h2 className="text-lg font-bold mb-4">📊 Individual Balances</h2>
      {balances.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <h3 className="font-semibold">All settled up!</h3>
          <p className="text-muted text-sm">No outstanding balances in this group</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {balances.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).map((b) => (
            <div key={b.userId}>
              <div
                className="balance-card"
                style={{ cursor: 'pointer' }}
                onClick={() => toggleBreakdown(b.userId)}
                id={`balance-${b.userId}`}
              >
                <div className="flex items-center gap-3">
                  <div className="avatar">{getInitials(b.name)}</div>
                  <div>
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-xs text-muted">
                      {b.net > 0 ? 'is owed money' : b.net < 0 ? 'owes money' : 'is settled up'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`text-xl font-bold ${b.net > 0.01 ? 'amount-positive' : b.net < -0.01 ? 'amount-negative' : 'amount-zero'}`}>
                    {b.net > 0.01 && '+'}
                    {formatINR(b.net)}
                  </div>
                  {b.net > 0.01 ? <TrendingUp size={16} color="var(--green)" /> : b.net < -0.01 ? <TrendingDown size={16} color="var(--red)" /> : null}
                  {expandedUser === b.userId ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                </div>
              </div>

              {/* Breakdown panel */}
              {expandedUser === b.userId && (
                <div className="card" style={{
                  borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                  borderTop: 'none',
                  marginTop: '-4px',
                  paddingTop: '1rem'
                }}>
                  {loadingBreakdown === b.userId ? (
                    <div className="flex justify-center" style={{ padding: '1rem' }}>
                      <span className="spinner" />
                    </div>
                  ) : breakdown[b.userId]?.length > 0 ? (
                    <>
                      <p className="text-xs text-muted mb-3 font-semibold uppercase" style={{ letterSpacing: '0.08em' }}>
                        Expense breakdown for {b.name}
                      </p>
                      <div className="table-wrapper">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Description</th>
                              <th>Paid by</th>
                              <th>Total</th>
                              <th>Your share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {breakdown[b.userId].map((row) => (
                              <tr key={row.expenseId}>
                                <td className="text-xs text-muted">{row.date}</td>
                                <td>{row.description}</td>
                                <td className="text-xs">{row.paidByName ?? '—'}</td>
                                <td>{formatINR(row.totalAmount)}</td>
                                <td className={`font-semibold ${row.yourShare > 0 ? 'amount-negative' : 'amount-positive'}`}>
                                  {row.yourShare > 0 ? '-' : '+'}{formatINR(Math.abs(row.yourShare))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted" style={{ textAlign: 'center', padding: '1rem' }}>
                      No expense history found for {b.name}
                    </p>
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
