import { useEffect, useState } from 'react';
import { Check, Copy, Cpu, Download, FileCode2 } from 'lucide-react';
import type { PythonBundleFile } from '../types';

const WIRING_ROWS = [
  { sensorPin: 'VCC (Red)', target: 'Raspberry Pi 5V / 3.3V (Pin 2 or 1)', notes: 'Powers optical LED prism' },
  { sensorPin: 'GND (Black)', target: 'Ground (Pin 6)', notes: 'Common reference ground' },
  { sensorPin: 'TX (Green)', target: 'USB-TTL RXD / GPIO15 (Pin 10)', notes: 'Sensor serial transmit (57600 bps)' },
  { sensorPin: 'RX (White)', target: 'USB-TTL TXD / GPIO14 (Pin 8)', notes: 'Sensor serial receive (57600 bps)' },
];

export function PythonPiSuiteView() {
  const [files, setFiles] = useState<PythonBundleFile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('python_voting_system/biometric_sensor.py');
  const [copiedFile, setCopiedFile] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/python-files')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data?.files?.length) {
          setFiles(data.files);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const activeFile = files.find((f) => f.key === selectedKey) ?? files[0] ?? null;

  const setupCommands = `pip install -r python_voting_system/requirements.txt
sudo apt install python3-tk
python3 -m unittest discover -s python_voting_system -p "test_*.py" -v
python3 main.py --gui`;

  const handleCopyFile = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 1800);
  };

  const handleCopyCommands = async () => {
    await navigator.clipboard.writeText(setupCommands);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  const handleDownloadFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.key.split('/').pop() || 'script.py';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Hardware Station & Structured Pinout */}
      <section className="grid grid-cols-1 gap-6 rounded-lg border border-slate-200 bg-white p-6 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-5 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          {!imgError ? (
            <img
              src="/src/assets/images/pi_fingerprint_station_1795412802975.jpg"
              alt="Raspberry Pi 4 wired via USB-to-TTL serial adapter to an optical R307 fingerprint sensor module"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center p-6 text-center text-slate-600">
              <Cpu className="h-8 w-8 text-slate-500" />
              <div className="mt-2 text-sm font-semibold">Raspberry Pi + R307 Station</div>
              <div className="mt-1 text-xs text-slate-500">UART 57600 bps · Security Level 5</div>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              PC &amp; Raspberry Pi Deployment (PyFingerprint + Tkinter + SQLite)
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Complete modular Python application in <code className="font-mono text-xs text-slate-800">main.py</code> and{' '}
              <code className="font-mono text-xs text-slate-800">python_voting_system/</code>. Supports R307, AS608, and ZFM-20 sensors at Security Level 5 with dual-pass enrollment and SQLite WAL atomic transactions.
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 font-medium">Sensor Pin</th>
                  <th className="px-3 py-2 font-medium">Raspberry Pi / USB-TTL Target</th>
                  <th className="px-3 py-2 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {WIRING_ROWS.map((row) => (
                  <tr key={row.sensorPin}>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {row.sensorPin}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{row.target}</td>
                    <td className="px-3 py-2 text-slate-600">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">Installation &amp; Launch Commands</span>
              <button
                type="button"
                onClick={handleCopyCommands}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
              >
                {copiedCmd ? <Check className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                {copiedCmd ? 'Copied' : 'Copy Commands'}
              </button>
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-slate-700 leading-relaxed">
              {setupCommands}
            </pre>
          </div>
        </div>
      </section>

      {/* Organized Module Explorer */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Python Source Code Explorer</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Select a module from the project tree to inspect, copy, or download.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyFile}
              disabled={!activeFile}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              {copiedFile ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedFile ? 'Copied' : 'Copy File'}
            </button>
            <button
              type="button"
              onClick={handleDownloadFile}
              disabled={!activeFile}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Download File
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Vertical Project Tree */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 p-3 space-y-1">
            {files.map((f) => {
              const selected = activeFile?.key === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSelectedKey(f.key)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
                    selected
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{f.label}</span>
                </button>
              );
            })}
          </div>

          {/* Code Viewport */}
          <div className="lg:col-span-8 max-h-96 overflow-auto bg-slate-950 p-4">
            <pre className="font-mono text-xs leading-relaxed text-slate-100">
              {activeFile ? activeFile.content : 'Loading Python source files...'}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
