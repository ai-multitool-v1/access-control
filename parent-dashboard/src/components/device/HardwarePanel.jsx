import { useEffect, useState } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { api } from '../../services/api.js';
import { command } from '../../services/ws.js';
import { SpatialCard, fmtTime } from '../ui.jsx';

/**
 * Full hardware / sensor / configuration spec sheet of the connected device.
 * Data comes from the child's hardware report (devices.hardware JSONB).
 */
export default function HardwarePanel({ deviceId, conn }) {
  const [hw, setHw] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const h = await api(`/api/devices/${deviceId}/hardware`);
      setHw(h.hardware);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, [deviceId]);

  async function refresh() {
    setMsg('');
    try {
      await command('refresh_hardware', {});
      setMsg('Child is re-uploading the hardware report — refreshing in 8s.');
      setTimeout(load, 8000);
    } catch (e) {
      setMsg(`Refresh failed: ${e.message}`);
    }
  }

  if (busy && !hw) {
    return (
      <SpatialCard className="p-6">
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">Loading hardware report…</p>
      </SpatialCard>
    );
  }

  function downloadReport() {
    if (!hw) return;
    const blob = new Blob([JSON.stringify(hw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hardware-${hw.model || 'device'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <SpatialCard className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-base font-black uppercase tracking-widest text-white">Hardware &amp; configuration</h3>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={downloadReport} disabled={!hw}>
            <Download className="h-3.5 w-3.5" /> Download report
          </button>
          <button className="btn-ghost px-3 py-2 text-[10px]" onClick={refresh} disabled={conn !== 'connected'}>
            <RefreshCw className="h-3.5 w-3.5" /> Re-scan device
          </button>
        </div>
      </div>
      {msg && <p className="mb-3 border-2 border-space-600 bg-space-700/60 px-3 py-2 font-mono text-[11px] text-slate-300">{msg}</p>}

      {!hw ? (
        <p className="py-8 text-center font-mono text-xs uppercase text-slate-600">
          No hardware report yet — connect the device and press re-scan.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Spec label="Manufacturer" value={hw.manufacturer} />
            <Spec label="Model" value={hw.model} />
            <Spec label="Device / Product" value={[hw.device, hw.product].filter(Boolean).join(' / ')} />
            <Spec label="Board" value={hw.board} />
            <Spec label="Hardware (SOC)" value={hw.hardware} />
            <Spec label="Android" value={`${hw.androidVersion || '?'} (SDK ${hw.sdkInt})`} />
            <Spec label="Security patch" value={hw.securityPatch} />
            <Spec label="Build / fingerprint" value={hw.buildId} mono />
            <Spec label="Kernel" value={hw.kernelVersion} mono />
            <Spec label="Bootloader" value={hw.bootloader} mono />
            <Spec label="Radio" value={hw.radioVersion} mono />
            <Spec label="ABIs" value={(hw.supportedAbis || []).join(', ')} mono />
            <Spec label="RAM total / free" value={hw.ramTotalGb ? `${hw.ramTotalGb} / ${hw.ramAvailableGb} GB` : null} />
            <Spec label="Storage total / free" value={hw.storageTotalGb ? `${hw.storageTotalGb} / ${hw.storageFreeGb} GB` : null} />
            <Spec label="Report generated" value={fmtTime(hw.generatedAt)} />
          </div>

          {hw.screen && (
            <Section title="Screen">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Spec label="Resolution" value={`${hw.screen.widthPx} × ${hw.screen.heightPx} px`} />
                <Spec label="Density" value={`${hw.screen.densityDpi} dpi (${Math.round(hw.screen.xdpi)}×${Math.round(hw.screen.ydpi)} ppi)`} />
                <Spec label="Refresh rate" value={`${Math.round(hw.screen.refreshHz || 0)} Hz`} />
              </div>
            </Section>
          )}

          {hw.battery && (
            <Section title="Battery">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <Spec label="Level" value={`${hw.battery.level}%`} />
                <Spec label="Charging" value={hw.battery.charging ? 'yes' : 'no'} />
                <Spec label="Technology" value={hw.battery.technology} />
                <Spec label="Health" value={hw.battery.health} />
                <Spec label="Temperature" value={hw.battery.temperatureC != null ? `${hw.battery.temperatureC} °C` : null} />
                <Spec label="Voltage" value={hw.battery.voltageMv ? `${hw.battery.voltageMv} mV` : null} />
              </div>
            </Section>
          )}

          {hw.telephony && (
            <Section title="Connectivity">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Spec label="Operator" value={hw.telephony.operator} />
                <Spec label="Country" value={hw.telephony.country} />
                <Spec label="SIM state" value={hw.telephony.simState} />
                <Spec label="Network" value={hw.network} />
              </div>
            </Section>
          )}

          {hw.features && (
            <Section title="Features">
              <div className="flex flex-wrap gap-2">
                {Object.entries(hw.features).map(([k, v]) => (
                  <span key={k} className={v ? 'chip chip-ok' : 'chip border-space-600 text-slate-600'}>{k}</span>
                ))}
              </div>
            </Section>
          )}

          {hw.cameras && hw.cameras.length > 0 && (
            <Section title={`Cameras (${hw.cameras.length})`}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {hw.cameras.map((c, i) => (
                  <Spec key={i} label={`#${c.id} ${c.facing}`} value={[c.maxJpeg, c.flash ? 'flash' : null].filter(Boolean).join(' · ')} />
                ))}
              </div>
            </Section>
          )}

          {hw.sensors && hw.sensors.length > 0 && (
            <Section title={`Sensors (${hw.sensorCount || hw.sensors.length})`}>
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {hw.sensors.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 border border-space-600 bg-space-700/40 px-3 py-1.5">
                    <div className="min-w-0">
                      <span className="truncate font-mono text-[11px] font-bold text-slate-200">{s.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-slate-500">{s.vendor}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-neon-dim">{s.powerMa} mA</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </SpatialCard>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-2 border-space-600 p-3">
      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-neon-dim">{title}</div>
      {children}
    </div>
  );
}

function Spec({ label, value, mono }) {
  return (
    <div className="border border-space-600 bg-space-700/40 px-3 py-2">
      <div className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-0.5 break-all text-xs font-bold text-slate-200 ${mono ? 'font-mono text-[10px]' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}
