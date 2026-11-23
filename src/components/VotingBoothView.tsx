import { FormEvent, useState } from 'react';
import { Check, CheckCircle2, Copy, ShieldAlert } from 'lucide-react';
import { FingerprintCanvas } from './FingerprintCanvas';
import type { VoterStatus, VotingState } from '../types';

interface VotingBoothViewProps {
  state: VotingState;
  loading: boolean;
  authenticatedVoter: VoterStatus | null;
  authConfidence: number;
  authQuality: number;
  lastReceiptHash: string | null;
  onAuthenticate: (ridgeSeed: string) => Promise<boolean>;
  onCastVote: (ridgeSeed: string, candidateId: number) => Promise<boolean>;
  onClearSession: () => void;
}

const DEMO_RIDGE_SEEDS: Record<string, string> = {
  'NID-2026-01': 'nadia-right-index-01',
  'NID-2026-02': 'tariq-right-thumb-02',
  'NID-2026-03': 'clara-left-index-03',
};

export function VotingBoothView({
  state,
  loading,
  authenticatedVoter,
  authConfidence,
  authQuality,
  lastReceiptHash,
  onAuthenticate,
  onCastVote,
  onClearSession,
}: VotingBoothViewProps) {
  const [ridgeSeed, setRidgeSeed] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  const isElectionActive = state.config.status === 'active';

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await onAuthenticate(ridgeSeed);
    setScanFailed(!ok);
    if (ok && state.candidates.length > 0 && selectedCandidateId === null) {
      setSelectedCandidateId(state.candidates[0].id);
    }
  };

  const handleVoteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authenticatedVoter || selectedCandidateId === null) return;
    const ok = await onCastVote(ridgeSeed, selectedCandidateId);
    if (ok) {
      setRidgeSeed('');
      setSelectedCandidateId(null);
      setScanFailed(false);
    }
  };

  const handleCopyReceipt = async () => {
    if (!lastReceiptHash) return;
    await navigator.clipboard.writeText(lastReceiptHash);
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 1800);
  };

  const canvasStatus = authenticatedVoter
    ? 'verified'
    : scanFailed
    ? 'rejected'
    : loading
    ? 'scanning'
    : 'idle';

  const thresholdPct = Math.min(100, Math.round((state.config.minConfidenceScore / 200) * 100));
  const confidencePct = Math.min(100, Math.round((authConfidence / 200) * 100));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Biometric Verification Station */}
      <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">01. Biometric Voter Scanner</h2>
        <p className="mt-1 text-sm text-slate-600">
          Runs 1:N search against enrolled templates and gates at Security Level {state.config.securityLevel} (threshold {state.config.minConfidenceScore}).
        </p>

        <div className="mt-4 flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 py-3.5 px-4">
          <FingerprintCanvas
            seed={ridgeSeed || 'booth-idle'}
            status={canvasStatus}
            label={
              authenticatedVoter
                ? `Matched (${authConfidence}/200 · Quality ${authQuality}%)`
                : scanFailed
                ? 'Verification Rejected'
                : 'Place Finger to Authenticate'
            }
          />

          {/* Match Confidence Gauge */}
          <div className="mt-3 w-full max-w-64">
            <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
              <span>Match Confidence</span>
              <span className="font-mono font-semibold text-slate-800">
                {authenticatedVoter ? authConfidence : 0} / 200
              </span>
            </div>
            <div className="relative mt-1 h-2 w-full overflow-hidden rounded bg-slate-200">
              <div
                className={`h-full transition-all duration-200 ${
                  authenticatedVoter ? 'bg-emerald-600' : 'bg-slate-400'
                }`}
                style={{ width: `${authenticatedVoter ? confidencePct : 0}%` }}
              />
              <div
                title={`Minimum threshold: ${state.config.minConfidenceScore}`}
                className="absolute top-0 bottom-0 w-0.5 bg-slate-900"
                style={{ left: `${thresholdPct}%` }}
              />
            </div>
          </div>
        </div>

        <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="booth-ridge-seed" className="block text-xs font-medium text-slate-700">
              Fingerprint Ridge Seed
            </label>
            <input
              id="booth-ridge-seed"
              type="text"
              value={ridgeSeed}
              onChange={(e) => {
                setRidgeSeed(e.target.value);
                setScanFailed(false);
              }}
              placeholder="Enter enrolled fingerprint ridge seed"
              disabled={!isElectionActive || loading || Boolean(authenticatedVoter)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none disabled:bg-slate-100"
            />
          </div>

          {state.voters.some((v) => DEMO_RIDGE_SEEDS[v.nationalId]) && (
            <div>
              <div className="text-xs font-medium text-slate-500">Verification Sample Profiles</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {state.voters
                  .filter((v) => DEMO_RIDGE_SEEDS[v.nationalId])
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      disabled={!isElectionActive || loading || Boolean(authenticatedVoter)}
                      onClick={() => {
                        setRidgeSeed(DEMO_RIDGE_SEEDS[v.nationalId]);
                        setScanFailed(false);
                      }}
                      className="rounded border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap"
                    >
                      {v.fullName} {v.hasVoted ? '(Voted)' : ''}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!isElectionActive || loading || Boolean(authenticatedVoter)}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            Authenticate Fingerprint
          </button>
        </form>
      </section>

      {/* Right: Secret Ballot Panel */}
      <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">02. Official Secret Ballot Paper</h2>

        {!isElectionActive ? (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              Voting is currently closed ({state.config.status}). Use Start Election in the top bar once candidates and voters are ready.
            </div>
          </div>
        ) : !authenticatedVoter ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Ballot locked. Authenticate an eligible voter fingerprint on the left to unlock candidate selection.
            </div>
            {lastReceiptHash && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    Previous Secret Ballot Sealed
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyReceipt}
                    className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                  >
                    {copiedReceipt ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedReceipt ? 'Copied' : 'Copy Receipt'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-emerald-800">
                  Anonymous Cryptographic Receipt Hash (SHA-256 chained):
                </p>
                <div className="mt-1.5 break-all rounded border border-emerald-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800">
                  {lastReceiptHash}
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleVoteSubmit} className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <div>
                Verified Voter: <strong>{authenticatedVoter.fullName}</strong>{' '}
                <span className="font-mono text-xs text-emerald-800">
                  ({authenticatedVoter.nationalId} · Slot #{authenticatedVoter.templatePosition})
                </span>
              </div>
              <div className="font-mono text-xs font-semibold tabular-nums">
                Score {authConfidence}/200
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-medium text-slate-600">
                Select one candidate to cast your secret ballot:
              </div>
              {state.candidates.map((c, index) => {
                const selected = selectedCandidateId === c.id;
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors ${
                      selected
                        ? 'border-blue-700 bg-blue-50/50 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="ballot-candidate"
                        checked={selected}
                        onChange={() => setSelectedCandidateId(c.id)}
                        className="h-4 w-4 accent-blue-700"
                      />
                      <div>
                        <div className="font-semibold text-slate-900">
                          {index + 1}. {c.name}
                        </div>
                        <div className="text-xs text-slate-500">{c.party}</div>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-600">
                      {c.symbolCode}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={loading || selectedCandidateId === null}
                className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
              >
                Cast Secret Ballot
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearSession();
                  setSelectedCandidateId(null);
                  setScanFailed(false);
                }}
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Cancel Session
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
