import { FormEvent, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { VotingState } from '../types';

interface OverviewControlViewProps {
  state: VotingState;
  loading: boolean;
  onAddCandidate: (name: string, party: string, symbolCode: string) => Promise<boolean>;
  onRemoveCandidate: (id: number) => Promise<void>;
  onSaveSettings: (title: string, securityLevel: number, minConfidenceScore: number) => Promise<void>;
  onReset: () => Promise<void>;
  onNavigate: (view: 'overview' | 'enrollment' | 'booth' | 'results' | 'python') => void;
}

const CALIBRATION_PRESETS = [
  { key: 'maximum', label: 'Maximum Accuracy', level: 5, score: 85 },
  { key: 'high', label: 'High Security', level: 4, score: 75 },
  { key: 'balanced', label: 'Balanced Standard', level: 3, score: 65 },
];

export function OverviewControlView({
  state,
  loading,
  onAddCandidate,
  onRemoveCandidate,
  onSaveSettings,
  onReset,
  onNavigate,
}: OverviewControlViewProps) {
  const [candName, setCandName] = useState('');
  const [candParty, setCandParty] = useState('');
  const [candSymbol, setCandSymbol] = useState('');

  const [title, setTitle] = useState(state.config.title);
  const [securityLevel, setSecurityLevel] = useState(state.config.securityLevel);
  const [minConfidence, setMinConfidence] = useState(state.config.minConfidenceScore);
  const [confirmReset, setConfirmReset] = useState(false);

  const isElectionActive = state.config.status === 'active';
  const hasCandidates = state.candidates.length > 0;
  const hasVoters = state.voters.length > 0;
  const hasVotes = state.totalVotes > 0;

  const readinessSteps = [
    {
      step: '01',
      title: 'Candidate Slate',
      detail: hasCandidates
        ? `${state.candidates.length} candidates registered`
        : 'Add at least one candidate',
      done: hasCandidates,
      actionLabel: 'Manage Slate',
      target: 'overview' as const,
    },
    {
      step: '02',
      title: 'Biometric Voter Roll',
      detail: hasVoters
        ? `${state.voters.length} templates enrolled`
        : 'Enroll voters via dual-pass scan',
      done: hasVoters,
      actionLabel: 'Open Enrollment',
      target: 'enrollment' as const,
    },
    {
      step: '03',
      title: 'Polling Operations',
      detail: isElectionActive
        ? 'Voting booth unlocked'
        : state.config.status === 'closed'
        ? 'Polls closed & sealed'
        : 'Ready to start election',
      done: isElectionActive || state.config.status === 'closed',
      actionLabel: 'Voting Booth',
      target: 'booth' as const,
    },
    {
      step: '04',
      title: 'Audit & Tally',
      detail: hasVotes
        ? `${state.totalVotes} ballots verified`
        : 'Awaiting cast ballots',
      done: hasVotes && state.chain.valid,
      actionLabel: 'Inspect Audit',
      target: 'results' as const,
    },
  ];

  const handleCandidateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await onAddCandidate(candName, candParty, candSymbol);
    if (ok) {
      setCandName('');
      setCandParty('');
      setCandSymbol('');
    }
  };

  const handleSettingsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await onSaveSettings(title, securityLevel, minConfidence);
  };

  return (
    <div className="space-y-6">
      {/* Election Readiness Pipeline */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Election Readiness Pipeline</h2>
            <p className="text-xs text-slate-500">
              Complete stages 01 and 02 before opening the biometric voting booth.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-600 tabular-nums">
            {readinessSteps.filter((s) => s.done).length} / 4 stages complete
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {readinessSteps.map((item) => (
            <div
              key={item.step}
              className="flex flex-col justify-between gap-3 border-t-2 pt-3 border-slate-200"
              style={{ borderTopColor: item.done ? '#15803D' : '#CBD5E1' }}
            >
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-500">{item.step}</span>
                  <span
                    className={`inline-flex items-center gap-1 font-medium ${
                      item.done ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {item.done && <Check className="h-3.5 w-3.5" />}
                    {item.done ? 'Ready' : 'Pending'}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{item.title}</div>
                <div className="mt-0.5 text-xs text-slate-600">{item.detail}</div>
              </div>
              {item.target !== 'overview' && (
                <button
                  type="button"
                  onClick={() => onNavigate(item.target)}
                  className="self-start text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
                >
                  {item.actionLabel} →
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Candidate Registration & Slate */}
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Candidate Ballot Slate</h2>
              <p className="mt-1 text-sm text-slate-600">
                Register official candidates and ballot codes while in Setup Mode.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {state.candidates.length} registered
            </span>
          </div>

          <form onSubmit={handleCandidateSubmit} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label htmlFor="cand-name" className="block text-xs font-medium text-slate-700">
                Candidate Name
              </label>
              <input
                id="cand-name"
                type="text"
                value={candName}
                onChange={(e) => setCandName(e.target.value)}
                placeholder="e.g. Dr. Elena Vance"
                disabled={isElectionActive || loading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
              />
            </div>
            <div className="sm:col-span-4">
              <label htmlFor="cand-party" className="block text-xs font-medium text-slate-700">
                Party / Affiliation
              </label>
              <input
                id="cand-party"
                type="text"
                value={candParty}
                onChange={(e) => setCandParty(e.target.value)}
                placeholder="Independent"
                disabled={isElectionActive || loading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="cand-symbol" className="block text-xs font-medium text-slate-700">
                Ballot Code
              </label>
              <input
                id="cand-symbol"
                type="text"
                maxLength={6}
                value={candSymbol}
                onChange={(e) => setCandSymbol(e.target.value.toUpperCase())}
                placeholder="CRA"
                disabled={isElectionActive || loading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
              />
            </div>
            <div className="sm:col-span-12 pt-1">
              <button
                type="submit"
                disabled={isElectionActive || loading}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                Add Candidate
              </button>
            </div>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-4">
            {state.candidates.length === 0 ? (
              <p className="text-sm text-slate-500">
                No candidates registered yet. Add at least one candidate to begin.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Candidate</th>
                      <th className="py-2 pr-3">Affiliation</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {state.candidates.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-700">
                          {c.symbolCode}
                        </td>
                        <td className="py-2.5 pr-3 font-medium text-slate-900">{c.name}</td>
                        <td className="py-2.5 pr-3 text-slate-600">{c.party}</td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onRemoveCandidate(c.id)}
                            disabled={isElectionActive || loading}
                            aria-label={`Remove ${c.name}`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Biometric Accuracy Calibration & Safe Reset */}
        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Biometric Accuracy Calibration</h2>
            <p className="mt-1 text-sm text-slate-600">
              Select a verification profile or tune R307/AS608 hardware thresholds.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-1.5 rounded-md bg-slate-100 p-1">
              {CALIBRATION_PRESETS.map((preset) => {
                const active = securityLevel === preset.level && minConfidence === preset.score;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={isElectionActive || loading}
                    onClick={() => {
                      setSecurityLevel(preset.level);
                      setMinConfidence(preset.score);
                    }}
                    className={`rounded px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap truncate ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    } disabled:opacity-50`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleSettingsSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="election-title" className="block text-xs font-medium text-slate-700">
                  Election Title
                </label>
                <input
                  id="election-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isElectionActive || loading}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
                />
              </div>

              <div>
                <label htmlFor="sec-level" className="block text-xs font-medium text-slate-700">
                  Sensor Security Level (1 Lowest – 5 Strictest FAR)
                </label>
                <select
                  id="sec-level"
                  value={securityLevel}
                  onChange={(e) => setSecurityLevel(Number(e.target.value))}
                  disabled={isElectionActive || loading}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
                >
                  <option value={5}>Level 5 — Maximum Accuracy (FAR &lt; 0.001%)</option>
                  <option value={4}>Level 4 — High Security</option>
                  <option value={3}>Level 3 — Balanced Standard</option>
                  <option value={2}>Level 2 — Permissive</option>
                  <option value={1}>Level 1 — Minimal</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="min-confidence" className="block text-xs font-medium text-slate-700">
                    Minimum Match Confidence Threshold
                  </label>
                  <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums">
                    {minConfidence} / 200
                  </span>
                </div>
                <input
                  id="min-confidence"
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  disabled={isElectionActive || loading}
                  className="mt-2 w-full accent-blue-700"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Recommended: 85 or higher for dual-pass template verification.
                </p>
              </div>

              <button
                type="submit"
                disabled={isElectionActive || loading}
                className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                Save Calibration
              </button>
            </form>
          </div>

          <div className="mt-8 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Machine Reset</h3>
            <p className="mt-1 text-xs text-slate-600">
              Clears all SQLite candidates, enrolled biometric templates, and ballot records.
            </p>
            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                disabled={loading}
                className="mt-3 rounded-md border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap"
              >
                Reset Election Database
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onReset();
                    setConfirmReset(false);
                  }}
                  disabled={loading}
                  className="rounded-md bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50 whitespace-nowrap"
                >
                  Confirm Permanent Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
