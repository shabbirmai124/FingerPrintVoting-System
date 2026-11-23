export interface ElectionConfig {
  id: number;
  title: string;
  status: 'setup' | 'active' | 'closed';
  securityLevel: number;
  minConfidenceScore: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Candidate {
  id: number;
  name: string;
  party: string;
  symbolCode: string;
  voteCount: number;
  createdAt: string;
}

export interface VoterStatus {
  id: number;
  nationalId: string;
  fullName: string;
  templatePosition: number;
  templateHashPreview: string;
  enrollmentScore: number;
  hasVoted: boolean;
  votedAt: string | null;
  enrolledAt: string;
}

export interface AuditLogEntry {
  id: number;
  eventType: string;
  actor: string;
  matchScore: number | null;
  outcome: 'SUCCESS' | 'REJECTED' | 'INFO';
  details: string;
  createdAt: string;
}

export interface ChainVerification {
  valid: boolean;
  ballotCount: number;
  headHash: string;
  reason: string;
}

export interface VotingState {
  config: ElectionConfig;
  totalVotes: number;
  candidates: Candidate[];
  results: Candidate[];
  voters: VoterStatus[];
  auditLogs: AuditLogEntry[];
  chain: ChainVerification;
}

export interface PythonBundleFile {
  key: string;
  label: string;
  content: string;
}
