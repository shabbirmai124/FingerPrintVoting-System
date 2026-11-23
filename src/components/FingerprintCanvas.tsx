import { useEffect, useRef } from 'react';

interface FingerprintCanvasProps {
  seed: string;
  status: 'idle' | 'scanning' | 'verified' | 'rejected';
  label?: string;
}

function hashSeed(input: string): number[] {
  const bytes: number[] = [];
  let h = 2166136261;
  const source = input.trim() || 'optical-prism-idle';
  for (let i = 0; i < 32; i += 1) {
    const ch = source.charCodeAt(i % source.length);
    h ^= ch + i * 31;
    h = Math.imul(h, 16777619) >>> 0;
    bytes.push(h & 0xff);
  }
  return bytes;
}

export function FingerprintCanvas({ seed, status, label }: FingerprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let sweepY = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Matte optical prism housing
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, w, h);

      // Subtle calibration reticle
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 12);
      ctx.lineTo(cx, h - 12);
      ctx.moveTo(12, cy);
      ctx.lineTo(w - 12, cy);
      ctx.stroke();

      const palette =
        status === 'verified'
          ? { ridge: '#22C55E', node: '#DCFCE7' }
          : status === 'rejected'
          ? { ridge: '#EF4444', node: '#FEE2E2' }
          : status === 'scanning'
          ? { ridge: '#38BDF8', node: '#E0F2FE' }
          : { ridge: '#64748B', node: '#CBD5E1' };

      const bytes = hashSeed(seed);
      ctx.strokeStyle = palette.ridge;
      ctx.lineWidth = 2;

      // Concentric biometric ridge curves with deterministic whorl offset
      for (let ring = 1; ring <= 9; ring += 1) {
        const rx = ring * 8.5;
        const ry = ring * 10.5;
        const shiftX = ((bytes[ring] % 9) - 4) * 1.1;
        const shiftY = ((bytes[ring + 10] % 7) - 3) * 0.8;
        const gapStart = (bytes[ring + 4] / 255) * Math.PI * 2;
        const gapSpan = 0.45 + (bytes[ring + 8] % 5) * 0.1;

        ctx.beginPath();
        ctx.ellipse(
          cx + shiftX,
          cy + shiftY,
          rx,
          ry,
          ((bytes[ring] % 5) - 2) * 0.05,
          gapStart + gapSpan,
          gapStart + Math.PI * 2
        );
        ctx.stroke();
      }

      // Minutiae points (ridge endings & bifurcations)
      for (let i = 0; i < 12; i += 1) {
        const angle = (bytes[i] / 255) * Math.PI * 2;
        const dist = 16 + (bytes[i + 12] % 64);
        const mx = cx + Math.cos(angle) * dist;
        const my = cy + Math.sin(angle) * dist;
        ctx.fillStyle = palette.node;
        ctx.beginPath();
        ctx.arc(mx, my, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (status === 'scanning' && !prefersReduced) {
        sweepY = (sweepY + 3) % h;
        const grad = ctx.createLinearGradient(0, sweepY - 12, 0, sweepY + 12);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
        grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.45)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, sweepY - 12, w, 24);
        rafId = window.requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [seed, status]);

  const statusLabel =
    label ??
    (status === 'verified'
      ? 'Biometric Verified'
      : status === 'rejected'
      ? 'Match Rejected'
      : status === 'scanning'
      ? 'Capturing Ridge Map'
      : 'Optical Sensor Ready');

  return (
    <div className="flex flex-col items-center">
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={192}
          height={192}
          data-testid="fingerprint-sensor-canvas"
          data-status={status}
          className="block"
        />
      </div>
      <div className="mt-2.5 text-xs font-medium text-slate-600">{statusLabel}</div>
    </div>
  );
}
