import { FormEvent, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { FingerprintCanvas } from './FingerprintCanvas';
import type { VotingState } from '../types';

interface BiometricEnrollmentViewProps {
  state: VotingState;
  loading: boolean;
  onEnrollVoter: (
    nationalId: string,
    fullName: string,
    seedPass1: string,
    seedPass2: string
  ) => Promise<boolean>;
}

type VoterFilter = 'all' | 'eligible' | 'voted';

export function BiometricEnrollmentView({
  state,
  loading,
  onEnrollVoter,
}: BiometricEnrollmentViewProps) {
  const [nationalId, setNationalId] = useState('');
  const [fullName, setFullName] = useState('');
  const [seedPass1, setSeedPass1] = useState('');
  const [seedPass2, setSeedPass2] = useState('');
  const [pass1Captured, setPass1Captured] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<VoterFilter>('all');

  const isElectionActive = state.config.status === 'active';

  const filteredVoters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.voters.filter((v) => {
      if (statusFilter === 'eligible' && v.hasVoted) return false;
      if (statusFilter === 'voted' && !v.hasVoted) return false;
      if (q) {
        return (
          v.fullName.toLowerCase().includes(q) ||
          v.nationalId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [state.voters, searchQuery, statusFilter]);

  const handleGenerateSampleSeed = () => {
    const cleanId = (nationalId.trim() || `voter-${state.voters.length + 1}`).toLowerCase();
    const generated = `${cleanId}-index-ridge`;
    setSeedPass1(generated);
    setPass1Captured(true);
    setSeedPass2(generated);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await onEnrollVoter(nationalId, fullName, seedPass1, seedPass2 || seedPass1);
    if (ok) {
      setNationalId('');
      setFullName('');
      setSeedPass1('');
      setSeedPass2('');
      setPass1Captured(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Dual-Pass Enrollment Form */}
      <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Dual-Pass Voter Enrollment</h2>
        <p className="mt-1 text-sm text-slate-600">
          Captures two independent finger scans, verifies 1:1 consistency, and blocks duplicate biometrics.
        </p>

        <div className="mt-4 flex justify-center rounded-lg border border-slate-200 bg-slate-50 py-4">
          <FingerprintCanvas
            seed={seedPass2 || seedPass1 || 'enrollment-idle'}
            status={loading ? 'scanning' : pass1Captured && seedPass1 ? 'verified' : 'idle'}
            label={
              pass1Captured && seedPass1
                ? 'Pass 1 & 2 Minutiae Ready'
                : 'Awaiting Biometric Capture'
            }
          />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold text-slate-500">01. Voter Identity</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="enroll-nid" className="block text-xs font-medium text-slate-700">
                  Voter / National ID
                </label>
                <input
                  id="enroll-nid"
                  type="text"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="NID-2026-04"
                  disabled={isElectionActive || loading}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
                />
              </div>
              <div>
                <label htmlFor="enroll-name" className="block text-xs font-medium text-slate-700">
                  Full Legal Name
                </label>
                <input
                  id="enroll-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Sadia Karim"
                  disabled={isElectionActive || loading}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500">02. Dual-Pass Scan Capture</div>
              <button
                type="button"
                onClick={handleGenerateSampleSeed}
                disabled={isElectionActive || loading}
                className="text-xs font-semibold text-blue-700 hover:underline disabled:opacity-40"
              >
                Simulate Sensor Scan
              </button>
            </div>

            <div>
              <label htmlFor="enroll-seed1" className="block text-xs font-medium text-slate-700">
                Pass 1 Biometric Ridge Sample
              </label>
              <input
                id="enroll-seed1"
                type="text"
                value={seedPass1}
                onChange={(e) => {
                  setSeedPass1(e.target.value);
                  setPass1Captured(Boolean(e.target.value.trim()));
                }}
                placeholder="e.g. sadia-right-index-04"
                disabled={isElectionActive || loading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
              />
            </div>

            <div>
              <label htmlFor="enroll-seed2" className="block text-xs font-medium text-slate-700">
                Pass 2 Cross-Verification Sample
              </label>
              <input
                id="enroll-seed2"
                type="text"
                value={seedPass2}
                onChange={(e) => setSeedPass2(e.target.value)}
                placeholder="Repeat Pass 1 finger scan to verify consistency"
                disabled={isElectionActive || loading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isElectionActive || loading}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            Enroll Biometric Template
          </button>
        </form>
      </section>

      {/* Registered Voter Roll Table with Search & Segmented Filter */}
      <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6 flex flex-col">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Enrolled Biometric Voter Roll</h2>
            <p className="mt-1 text-sm text-slate-600">
              SHA-256 salted fingerprint hashes synced with R307 flash slot positions.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredVoters.length} of {state.voters.length} voters
          </span>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="relative flex-1 min-w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label="Search enrolled voters"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name or National ID..."
              className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'eligible', label: 'Eligible' },
                { key: 'voted', label: 'Voted' },
              ] as { key: VoterFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredVoters.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            {state.voters.length === 0
              ? 'No voters enrolled yet. Enroll voters using the dual-pass scanner on the left.'
              : 'No enrolled voters match the current search or filter.'}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2 pr-3">National ID</th>
                  <th className="py-2 pr-3">Full Name</th>
                  <th className="py-2 pr-3 text-right">Slot</th>
                  <th className="py-2 pr-3 text-right">Consistency</th>
                  <th className="py-2 pr-3">Template Hash</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVoters.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-mono text-xs text-slate-700">{v.nationalId}</td>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">{v.fullName}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                      #{v.templatePosition}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {v.enrollmentScore}/200
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-slate-500">
                      {v.templateHashPreview}
                    </td>
                    <td
                      className={`py-2.5 text-right text-xs font-semibold ${
                        v.hasVoted ? 'text-emerald-700' : 'text-slate-600'
                      }`}
                    >
                      {v.hasVoted ? 'Voted' : 'Eligible'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
