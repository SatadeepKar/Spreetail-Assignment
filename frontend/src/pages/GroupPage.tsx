import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import BalancesTab from '../components/BalancesTab';
import ExpensesTab from '../components/ExpensesTab';
import MembersTab from '../components/MembersTab';
import SettlementsTab from '../components/SettlementsTab';
import ImportTab from '../components/ImportTab';

interface Group {
  id: number;
  name: string;
  description?: string;
}

interface Member {
  userId: number;
  name: string;
  email: string;
  joinedAt: string;
  leftAt?: string;
}

export type GroupTab = 'overview' | 'expenses' | 'members' | 'settlements' | 'import';

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const groupId = parseInt(id!);

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeTab, setActiveTab] = useState<GroupTab>('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  async function loadGroup() {
    try {
      const res = await api.get(`/api/groups/${groupId}`);
      setGroup(res.data.group);
      setMembers(res.data.members);
    } catch {
      toast.error('Group not found');
      navigate('/');
    } finally {
      setLoading(false);
    }
  }

  const tabs: { key: GroupTab; label: string; emoji: string }[] = [
    { key: 'overview', label: 'Overview', emoji: '⚖️' },
    { key: 'expenses', label: 'Expenses', emoji: '💳' },
    { key: 'members', label: 'Members', emoji: '👥' },
    { key: 'settlements', label: 'Settlements', emoji: '✅' },
    { key: 'import', label: 'Import CSV', emoji: '📥' },
  ];

  if (loading) {
    return (
      <div className="empty-state">
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (!group) return null;

  const activeMembers = members.filter((m) => !m.leftAt);

  return (
    <div className="fade-in">
      {/* Group header */}
      <div className="page-header">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              className="text-muted text-sm"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => navigate('/')}
            >
              Groups
            </button>
            <span className="text-muted">/</span>
          </div>
          <h1 className="page-title">{group.name}</h1>
          {group.description && <p className="page-subtitle">{group.description}</p>}
          <p className="text-xs text-muted mt-1">
            {activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''} ·{' '}
            {members.length} total
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <BalancesTab groupId={groupId} members={members} currentUserId={user?.id} />
      )}
      {activeTab === 'expenses' && (
        <ExpensesTab groupId={groupId} members={members} currentUserId={user?.id} />
      )}
      {activeTab === 'members' && (
        <MembersTab groupId={groupId} members={members} onRefresh={loadGroup} />
      )}
      {activeTab === 'settlements' && (
        <SettlementsTab groupId={groupId} members={members} />
      )}
      {activeTab === 'import' && (
        <ImportTab groupId={groupId} onComplete={() => { setActiveTab('expenses'); loadGroup(); }} />
      )}
    </div>
  );
}
