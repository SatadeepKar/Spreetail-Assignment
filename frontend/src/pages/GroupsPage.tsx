import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Users, Plus, ArrowRight, Calendar } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';

interface Group {
  id: number;
  name: string;
  description?: string;
  joinedAt: string;
  leftAt?: string;
}

export default function GroupsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    try {
      const res = await api.get('/api/groups');
      setGroups(res.data.groups.map((g: any) => ({
        id: g.group.id,
        name: g.group.name,
        description: g.group.description,
        joinedAt: g.joinedAt,
        leftAt: g.leftAt,
      })));
    } catch {
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/api/groups', { name: newName, description: newDesc });
      toast.success('Group created!');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      navigate(`/groups/${res.data.group.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Your Groups</h1>
          <p className="page-subtitle">Manage shared expenses across your households and trips</p>
        </div>
        <button id="create-group-btn" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Group
        </button>
      </div>

      {/* Create group modal */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '460px' }}>
            <h2 className="text-xl font-bold mb-6">Create Group</h2>
            <form onSubmit={createGroup} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Group Name</label>
                <input id="group-name" className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Flat 4B" required />
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <input id="group-desc" className="form-input" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Shared apartment expenses" />
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowCreate(false)}>Cancel</button>
                <button id="save-group-btn" type="submit" className="btn btn-primary w-full" disabled={creating}>
                  {creating ? <span className="spinner" /> : null} Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><span className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🏠</div>
          <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
          <p className="text-muted text-sm">Create your first group to start tracking shared expenses</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {groups.map((g) => (
            <div
              key={g.id}
              id={`group-${g.id}`}
              className="card card-hover"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => navigate(`/groups/${g.id}`)}
            >
              <div className="flex items-center gap-4">
                <div style={{
                  width: 44, height: 44,
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.3rem'
                }}>🏠</div>
                <div>
                  <div className="font-semibold">{g.name}</div>
                  {g.description && <div className="text-xs text-muted">{g.description}</div>}
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                    <Calendar size={11} />
                    Joined {formatDate(g.joinedAt)}
                    {g.leftAt && <span className="badge badge-red" style={{ marginLeft: 4 }}>Left {formatDate(g.leftAt)}</span>}
                  </div>
                </div>
              </div>
              <ArrowRight size={18} color="var(--text-muted)" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
