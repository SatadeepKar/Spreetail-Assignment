import React, { useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { formatDate, getInitials } from '../lib/utils';
import { UserPlus, UserMinus, Calendar } from 'lucide-react';

interface Member { userId: number; name: string; email: string; joinedAt: string; leftAt?: string; }
interface Props { groupId: number; members: Member[]; onRefresh: () => void; }

export default function MembersTab({ groupId, members, onRefresh }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: number; name: string; email: string }[]>([]);
  const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [leavingUserId, setLeavingUserId] = useState<number | null>(null);
  const [leaveDate, setLeaveDate] = useState(new Date().toISOString().split('T')[0]);

  async function searchUsers(q: string) {
    setSearchEmail(q);
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/api/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data.users);
    } catch { /* ignore */ }
  }

  async function addMember(userId: number) {
    setSaving(true);
    try {
      await api.post(`/api/groups/${groupId}/members`, { userId, joinedAt: joinDate });
      toast.success('Member added!');
      setShowAdd(false);
      setSearchEmail('');
      setSearchResults([]);
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add member');
    } finally { setSaving(false); }
  }

  async function markLeft(userId: number) {
    try {
      await api.patch(`/api/groups/${groupId}/members/${userId}/leave`, { leftAt: leaveDate });
      toast.success('Member marked as left');
      setLeavingUserId(null);
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update');
    }
  }

  const activeMembers = members.filter(m => !m.leftAt);
  const formerMembers = members.filter(m => m.leftAt);

  return (
    <div className="fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold">Members Timeline</h2>
        <button id="add-member-btn" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <UserPlus size={16} /> Add Member
        </button>
      </div>

      {/* Add member modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '400px' }}>
            <h2 className="text-xl font-bold mb-6">Add Member</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Search by name or email</label>
                <input
                  id="member-search"
                  className="form-input"
                  value={searchEmail}
                  onChange={e => searchUsers(e.target.value)}
                  placeholder="Type name..."
                  autoFocus
                />
              </div>
              {searchResults.length > 0 && (
                <div className="card" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {searchResults.map(u => (
                    <button
                      key={u.id}
                      className="btn btn-ghost"
                      style={{ justifyContent: 'flex-start', gap: '0.75rem', padding: '0.5rem 0.75rem' }}
                      onClick={() => addMember(u.id)}
                    >
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.7rem' }}>{getInitials(u.name)}</div>
                      <div style={{ textAlign: 'left' }}>
                        <div className="text-sm font-semibold">{u.name}</div>
                        <div className="text-xs text-muted">{u.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Joined on</label>
                <input id="join-date" className="form-input" type="date" value={joinDate} onChange={e => setJoinDate(e.target.value)} />
              </div>
              <button className="btn btn-secondary w-full" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave date picker modal */}
      {leavingUserId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '360px' }}>
            <h3 className="font-bold mb-4">Mark member as left</h3>
            <div className="form-group mb-4">
              <label className="form-label">Left on</label>
              <input className="form-input" type="date" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button className="btn btn-secondary w-full" onClick={() => setLeavingUserId(null)}>Cancel</button>
              <button className="btn btn-danger w-full" onClick={() => markLeft(leavingUserId)}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Active members */}
      <h3 className="text-sm font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.08em' }}>
        Active Members ({activeMembers.length})
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
        {activeMembers.map(m => (
          <div key={m.userId} className="balance-card" id={`member-${m.userId}`}>
            <div className="flex items-center gap-3">
              <div className="avatar avatar-lg">{getInitials(m.name)}</div>
              <div>
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-muted">{m.email}</div>
                <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                  <Calendar size={11} /> Joined {formatDate(m.joinedAt)}
                </div>
              </div>
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setLeavingUserId(m.userId)}
            >
              <UserMinus size={14} /> Mark Left
            </button>
          </div>
        ))}
      </div>

      {/* Former members */}
      {formerMembers.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.08em' }}>
            Former Members ({formerMembers.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: 0.6 }}>
            {formerMembers.map(m => (
              <div key={m.userId} className="balance-card">
                <div className="flex items-center gap-3">
                  <div className="avatar avatar-lg" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                    {getInitials(m.name)}
                  </div>
                  <div>
                    <div className="font-semibold">{m.name} <span className="badge badge-gray">Former</span></div>
                    <div className="text-xs text-muted">{m.email}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                      <span><Calendar size={11} /> Joined {formatDate(m.joinedAt)}</span>
                      <span>→ Left {formatDate(m.leftAt!)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
