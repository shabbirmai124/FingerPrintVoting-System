import { useMemo, useState } from 'react';
import { Download, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { VotingState } from '../types';

interface ResultsAuditViewProps {
  state: VotingState;
  onVerifyChain: () => Promise<void>;
}

type OutcomeFilter = 'ALL' | 'SUCCESS' | 'REJECTED' | 'INFO';

export function ResultsAuditView({ state, onVerifyChain }: ResultsAuditViewProps) {
  const [logSearch, setLogSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');

  const turnoutPct =
    state.voters.length > 0
      ? Math.round((state.totalVotes / state.voters.length) * 100)
      : 0;

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return state.auditLogs.filter((log) => {
      if (outcomeFilter !== 'ALL' && log.outcome !== outcomeFilter) return false;
      if (q) {
        return (
          log.eventType.toLowerCase().includes(q) ||
          log.actor.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [state.auditLogs, logSearch, outcomeFilter]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Live Tally */}
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Live Election Results</h2>
              <p className="mt-1 text-sm text-slate-600 tabular-nums">
                {state.totalVotes} ballots cast · {turnoutPct}% voter turnout ({state.totalVotes} / {state.voters.length} enrolled)
              </p>
            </div>
            <a
              href="/api/export/csv"
              download="election_results.csv"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Export Official CSV
            </a>
          </div>

          {state.results.length === 0 ? (
            <p className="mt-5 text-sm text-slate-500">No candidates registered yet.</p>
          ) : (
            <div className="mt-5 space-y-4">
              {state.results.map((c, idx) => {
                const pct =
                  state.totalVotes > 0
                    ? Math.round((c.voteCount / state.totalVotes) * 1000) / 10
                    : 0;
                const isLeading = idx === 0 && c.voteCount > 0;
                return (
                  <div key={c.id} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <div>
                        <span className="font-semibold text-slate-900">{c.name}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {c.party} · {c.symbolCode}
                          {isLeading ? ' · Leading' : ''}
                        </span>
                      </div>
                      <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                        {c.voteCount} votes ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded bg-slate-100">
                      <div
                        className={`h-full transition-all duration-200 ${
                          isLeading ? 'bg-blue-700' : 'bg-slate-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Cryptographic Hash Chain Verification */}
        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Ballot Chain Integrity</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Verifies SHA-256 ballot chaining and 1:1 parity with SQLite voter flags.
                </p>
              </div>
              {state.chain.valid ? (
                <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" />
              ) : (
                <ShieldAlert className="h-5 w-5 shrink-0 text-rose-700" />
              )}
            </div>

            <div
              className={`mt-5 rounded-md border p-4 text-sm ${
                state.chain.valid
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              <div className="font-semibold">
                {state.chain.valid ? 'Integrity Verified' : 'Integrity Warning'}
              </div>
              <p className="mt-1 text-xs">{state.chain.reason}</p>
              <div className="mt-3 space-y-1 font-mono text-xs tabular-nums">
                <div>Verified Ballots: {state.chain.ballotCount}</div>
                <div className="break-all">Head Hash: {state.chain.headHash}</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onVerifyChain}
            className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            Re-Verify Cryptographic Chain
          </button>
        </section>
      </div>

      {/* Biometric Audit Ledger with Search & Outcome Filter */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Biometric Audit Ledger</h2>
            <p className="mt-1 text-sm text-slate-600">
              Immutable log of dual-pass enrollments, duplicate rejections, and sealed ballots.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                aria-label="Search audit events"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter audit log..."
                className="w-48 rounded-md border border-slate-300 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              {(['ALL', 'SUCCESS', 'REJECTED', 'INFO'] as OutcomeFilter[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setOutcomeFilter(status)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    outcomeFilter === status
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'ALL' ? 'All' : status}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No audit events match the active filter.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 font-medium text-slate-500">
                  <th className="py-2 pr-3">Timestamp</th>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3 text-right">Score</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2 pr-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {log.createdAt}
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {log.eventType}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-700 whitespace-nowrap">
                      {log.actor}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-700 tabular-nums">
                      {log.matchScore !== null ? log.matchScore : '—'}
                    </td>
                    <td
                      className={`py-2 pr-3 font-semibold whitespace-nowrap ${
                        log.outcome === 'SUCCESS'
                          ? 'text-emerald-700'
                          : log.outcome === 'REJECTED'
                          ? 'text-rose-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {log.outcome}
                    </td>
                    <td className="py-2 text-slate-700">{log.details}</td>
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
