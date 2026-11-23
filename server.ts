import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BiometricVotingStore } from './server/biometricEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_BUNDLE_FILES = [
  { key: 'main.py', relPath: 'main.py', label: 'main.py (Launcher & CLI)' },
  {
    key: 'python_voting_system/biometric_sensor.py',
    relPath: 'python_voting_system/biometric_sensor.py',
    label: 'biometric_sensor.py (PyFingerprint Driver)',
  },
  {
    key: 'python_voting_system/database.py',
    relPath: 'python_voting_system/database.py',
    label: 'database.py (SQLite WAL & Hash Chain)',
  },
  {
    key: 'python_voting_system/gui_app.py',
    relPath: 'python_voting_system/gui_app.py',
    label: 'gui_app.py (Tkinter UI)',
  },
  {
    key: 'python_voting_system/config.py',
    relPath: 'python_voting_system/config.py',
    label: 'config.py (Accuracy Presets)',
  },
  {
    key: 'python_voting_system/test_voting_system.py',
    relPath: 'python_voting_system/test_voting_system.py',
    label: 'test_voting_system.py (Unit Tests)',
  },
  {
    key: 'python_voting_system/requirements.txt',
    relPath: 'python_voting_system/requirements.txt',
    label: 'requirements.txt',
  },
];

async function startServer() {
  const app = express();
  app.use(express.json());

  const store = new BiometricVotingStore(path.resolve(__dirname, 'web_voting_system.db'), true);

  app.get('/api/state', (_req, res) => {
    res.json(store.getState());
  });

  app.post('/api/settings', (req, res) => {
    const result = store.updateSettings({
      title: req.body?.title,
      securityLevel: req.body?.securityLevel,
      minConfidenceScore: req.body?.minConfidenceScore,
    });
    res.status(result.ok ? 200 : 400).json({ ...result, state: store.getState() });
  });

  app.post('/api/candidates', (req, res) => {
    const result = store.addCandidate(
      req.body?.name ?? '',
      req.body?.party ?? 'Independent',
      req.body?.symbolCode ?? ''
    );
    res.status(result.ok ? 201 : 400).json({ ...result, state: store.getState() });
  });

  app.delete('/api/candidates/:id', (req, res) => {
    const result = store.removeCandidate(Number(req.params.id));
    res.status(result.ok ? 200 : 400).json({ ...result, state: store.getState() });
  });

  app.post('/api/voters/enroll', (req, res) => {
    const result = store.enrollVoterDualPass(
      req.body?.nationalId ?? '',
      req.body?.fullName ?? '',
      req.body?.seedPass1 ?? '',
      req.body?.seedPass2 ?? ''
    );
    res.status(result.ok ? 201 : 400).json({ ...result, state: store.getState() });
  });

  app.post('/api/election/start', (_req, res) => {
    const result = store.startElection();
    res.status(result.ok ? 200 : 400).json({ ...result, state: store.getState() });
  });

  app.post('/api/election/stop', (_req, res) => {
    const result = store.stopElection();
    res.json({ ...result, state: store.getState() });
  });

  app.post('/api/vote/authenticate', (req, res) => {
    const result = store.authenticateBiometric(req.body?.ridgeSeed ?? '');
    res.status(result.ok ? 200 : 400).json({ ...result, state: store.getState() });
  });

  app.post('/api/vote/cast', (req, res) => {
    const result = store.castVoteAtomic(
      req.body?.ridgeSeed ?? '',
      Number(req.body?.candidateId)
    );
    res.status(result.ok ? 200 : 400).json({ ...result, state: store.getState() });
  });

  app.get('/api/chain/verify', (_req, res) => {
    res.json(store.verifyBallotChain());
  });

  app.get('/api/export/csv', (_req, res) => {
    const state = store.getState();
    const lines = ['Candidate ID,Name,Party,Symbol,Votes,Share (%)'];
    for (const c of state.results) {
      const pct = state.totalVotes > 0 ? ((c.voteCount / state.totalVotes) * 100).toFixed(2) : '0.00';
      lines.push(`${c.id},"${c.name.replaceAll('"', '""')}","${c.party.replaceAll('"', '""')}",${c.symbolCode},${c.voteCount},${pct}`);
    }
    lines.push('');
    lines.push(`Total Votes,${state.totalVotes}`);
    lines.push(`Chain Verified,${state.chain.valid}`);
    lines.push(`Chain Head Hash,${state.chain.headHash}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="election_results.csv"');
    res.send(lines.join('\n'));
  });

  app.post('/api/reset', (_req, res) => {
    const result = store.resetAll();
    res.json({ ...result, state: store.getState() });
  });

  app.get('/api/python-files', (_req, res) => {
    const files = PYTHON_BUNDLE_FILES.map((item) => {
      const fullPath = path.resolve(__dirname, item.relPath);
      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
      return {
        key: item.key,
        label: item.label,
        content,
      };
    });
    res.json({ files });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`FingerPrintVoting-System server running on http://0.0.0.0:${port}`);
  });
}

startServer();
