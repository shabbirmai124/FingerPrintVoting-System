import { useEffect, useState } from 'react';
import {
  BarChart3,
  Cpu,
  Fingerprint,
  SlidersHorizontal,
  Vote,
} from 'lucide-react';
import { BiometricEnrollmentView } from './components/BiometricEnrollmentView';
import { OverviewControlView } from './components/OverviewControlView';
import { PythonPiSuiteView } from './components/PythonPiSuiteView';
import { ResultsAuditView } from './components/ResultsAuditView';
import { VotingBoothView } from './components/VotingBoothView';
import type { VoterStatus, VotingState } from './types';

type ViewKey = 'overview' | 'enrollment' | 'booth' | 'results' | 'python';

interface FeedbackBanner {
  ok: boolean;
  message: string;
}

const NAV_ITEMS: { key: ViewKey; label: string; breadcrumb: string; icon: typeof SlidersHorizontal }[] = [
  { key: 'overview', label: 'Overview & Control', breadcrumb: 'Overview & Control', icon: SlidersHorizontal },
  { key: 'enrollment', label: 'Biometric Enrollment', breadcrumb: 'Biometric Enrollment', icon: Fingerprint },
  { key: 'booth', label: 'Voting Booth', breadcrumb: 'Voting Booth', icon: Vote },
  { key: 'results', label: 'Results & Audit', breadcrumb: 'Results & Audit', icon: BarChart3 },
  { key: 'python', label: 'Python / Pi Suite', breadcrumb: 'Python / Pi Suite', icon: Cpu },
];

const INITIAL_STATE: VotingState = {
  config: {
    id: 1,
    title: 'Municipal Biometric General Election',
    status: 'setup',
    securityLevel: 5,
    minConfidenceScore: 85,
    createdAt: '',
    startedAt: null,
    endedAt: null,
  },
  totalVotes: 0,
  candidates: [],
  results: [],
  voters: [],
  auditLogs: [],
  chain: {
    valid: true,
    ballotCount: 0,
    headHash: '0'.repeat(64),
    reason: 'Chain ready.',
  },
};

export default function App() {
  const [state, setState] = useState<VotingState>(INITIAL_STATE);
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackBanner | null>(null);

  // Voting booth session state
  const [authenticatedVoter, setAuthenticatedVoter] = useState<VoterStatus | null>(null);
  const [authConfidence, setAuthConfidence] = useState(0);
  const [authQuality, setAuthQuality] = useState(0);
  const [lastReceiptHash, setLastReceiptHash] = useState<string | null>(null);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data: VotingState = await res.json();
        setState(data);
      }
    } catch {
      setFeedback({ ok: false, message: 'Unable to reach voting server.' });
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  const handleAddCandidate = async (
    name: string,
    party: string,
    symbolCode: string
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, party, symbolCode }),
      });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
      return Boolean(data.ok);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveCandidate = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (
    title: string,
    securityLevel: number,
    minConfidenceScore: number
  ) => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, securityLevel, minConfidenceScore }),
      });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollVoter = async (
    nationalId: string,
    fullName: string,
    seedPass1: string,
    seedPass2: string
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch('/api/voters/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId, fullName, seedPass1, seedPass2 }),
      });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
      return Boolean(data.ok);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleElection = async () => {
    setLoading(true);
    try {
      const endpoint =
        state.config.status === 'active' ? '/api/election/stop' : '/api/election/start';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
      if (endpoint === '/api/election/stop') {
        setAuthenticatedVoter(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAuthenticate = async (ridgeSeed: string): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch('/api/vote/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ridgeSeed }),
      });
      const data = await res.json();
      if (data.state) setState(data.state);
      if (data.ok && data.voter) {
        setAuthenticatedVoter(data.voter);
        setAuthConfidence(data.confidenceScore ?? 0);
        setAuthQuality(data.qualityScore ?? 0);
        setFeedback(null);
        return true;
      }
      setFeedback({ ok: false, message: data.message });
      setAuthenticatedVoter(null);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleCastVote = async (ridgeSeed: string, candidateId: number): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch('/api/vote/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ridgeSeed, candidateId }),
      });
      const data = await res.json();
      if (data.state) setState(data.state);
      setFeedback({ ok: Boolean(data.ok), message: data.message });
      if (data.ok) {
        setAuthenticatedVoter(null);
        setAuthConfidence(0);
        setAuthQuality(0);
        setLastReceiptHash(data.receiptHash ?? null);
        return true;
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChain = async () => {
    setLoading(true);
    try {
      await fetchState();
      setFeedback({
        ok: state.chain.valid,
        message: state.chain.reason,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      const data = await res.json();
      if (data.state) setState(data.state);
      setAuthenticatedVoter(null);
      setLastReceiptHash(null);
      setFeedback({ ok: true, message: data.message });
    } finally {
      setLoading(false);
    }
  };

  const activeNav = NAV_ITEMS.find((item) => item.key === activeView) ?? NAV_ITEMS[0];
  const isElectionActive = state.config.status === 'active';
  const statusLabel =
    state.config.status === 'active'
      ? 'Election Active'
      : state.config.status === 'closed'
      ? 'Election Sealed'
      : 'Setup Mode';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Biometric Voting
          </div>
        </div>

        <nav aria-label="Primary Sidebar Navigation" className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-600 space-y-1">
          <div className="font-semibold text-slate-800">Active Calibration</div>
          <div className="tabular-nums">Security Level {state.config.securityLevel} of 5</div>
          <div className="tabular-nums">Min Match Score: {state.config.minConfidenceScore}</div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract (3 zones) */}
        <header className="border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-8 px-6 py-4">
            <div className="min-w-0 truncate text-sm font-medium text-slate-600">
              <span>Election Console</span>
              <span className="mx-2 text-slate-400" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900">{activeNav.breadcrumb}</span>
            </div>

            <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap shrink-0">
              <span
                className={
                  isElectionActive
                    ? 'font-semibold text-emerald-700'
                    : 'font-semibold text-slate-700'
                }
              >
                {statusLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Level {state.config.securityLevel}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Threshold {state.config.minConfidenceScore}</span>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                onClick={handleToggleElection}
                disabled={loading}
                className={`rounded-md px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 ${
                  isElectionActive
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {isElectionActive ? 'Stop Election' : 'Start Election'}
              </button>
            </div>
          </div>

          {/* Mobile Navigation Bar */}
          <nav
            aria-label="Mobile Navigation"
            className="flex lg:hidden overflow-x-auto border-t border-slate-200 px-4 py-2 gap-1.5"
          >
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                  activeView === item.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-6 py-6 max-w-7xl w-full mx-auto space-y-6">
          {/* Election Header & KPI Row */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                {state.config.title}
              </h1>
              <span className="text-xs text-slate-500">
                SQLite WAL Atomic Ledger · SHA-256 Ballot Chain
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
                <div className="text-xs font-medium text-slate-500">Candidates</div>
                <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {state.candidates.length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
                <div className="text-xs font-medium text-slate-500">Enrolled Voters</div>
                <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {state.voters.length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
                <div className="text-xs font-medium text-slate-500">Secret Ballots Cast</div>
                <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {state.totalVotes}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5">
                <div className="text-xs font-medium text-slate-500">Chain Integrity</div>
                <div
                  className={`mt-1 font-display text-lg font-bold ${
                    state.chain.valid ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {state.chain.valid ? 'Verified' : 'Alert'}
                </div>
              </div>
            </div>
          </div>

          {/* Action Feedback Alert */}
          {feedback && (
            <div
              role="status"
              className={`flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-sm ${
                feedback.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              <span>{feedback.message}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-xs font-semibold underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Active Workspace View */}
          {activeView === 'overview' && (
            <OverviewControlView
              state={state}
              loading={loading}
              onAddCandidate={handleAddCandidate}
              onRemoveCandidate={handleRemoveCandidate}
              onSaveSettings={handleSaveSettings}
              onReset={handleReset}
              onNavigate={setActiveView}
            />
          )}

          {activeView === 'enrollment' && (
            <BiometricEnrollmentView
              state={state}
              loading={loading}
              onEnrollVoter={handleEnrollVoter}
            />
          )}

          {activeView === 'booth' && (
            <VotingBoothView
              state={state}
              loading={loading}
              authenticatedVoter={authenticatedVoter}
              authConfidence={authConfidence}
              authQuality={authQuality}
              lastReceiptHash={lastReceiptHash}
              onAuthenticate={handleAuthenticate}
              onCastVote={handleCastVote}
              onClearSession={() => setAuthenticatedVoter(null)}
            />
          )}

          {activeView === 'results' && (
            <ResultsAuditView state={state} onVerifyChain={handleVerifyChain} />
          )}

          {activeView === 'python' && <PythonPiSuiteView />}
        </main>
      </div>
    </div>
  );
}
