// HardwareList — renders the child's full hardware report as a structured,
// icon-led list instead of a raw JSON dump. Every section gets an icon, a
// readable label set, and formatted values (units, booleans, chips).
//
// The shape mirrors DeviceInfoProvider.hardwareJson() from the child app:
//   scalars  : manufacturer, brand, model, device, product, board, hardware,
//              androidVersion, sdkInt, buildId, fingerprint, bootloader,
//              radioVersion, kernelVersion, securityPatch, appVersion,
//              ramTotalGb, ramAvailableGb, lowRamDevice, storageTotalGb,
//              storageFreeGb, network, sensorCount, generatedAt
//   arrays   : supportedAbis, sensors[], cameras[]
//   objects  : screen{}, battery{}, telephony{}, features{}

import { useEffect, useRef, useState } from 'react';
import {
  Smartphone, Settings2, MemoryStick, MonitorSmartphone, BatteryCharging,
  Wifi, Cpu, ListChecks, Camera, Radar, ChevronDown, Check, Minus,
  HardDrive, CircuitBoard,
} from 'lucide-react';
import { revealChildren, popIn } from '../lib/anim.js';

// camelCase -> readable label (keeps unit suffixes attached)
const LABELS = {
  manufacturer: 'Manufacturer', brand: 'Brand', model: 'Model', device: 'Device code',
  product: 'Product', board: 'Board', hardware: 'Hardware name', androidVersion: 'Android version',
  sdkInt: 'SDK (API level)', buildId: 'Build ID', fingerprint: 'Build fingerprint',
  bootloader: 'Bootloader', radioVersion: 'Radio / baseband', kernelVersion: 'Kernel version',
  securityPatch: 'Security patch', appVersion: 'App version', ramTotalGb: 'RAM total',
  ramAvailableGb: 'RAM available', lowRamDevice: 'Low-RAM device', storageTotalGb: 'Storage total',
  storageFreeGb: 'Storage free', network: 'Network state', sensorCount: 'Sensor count',
  generatedAt: 'Report generated', widthPx: 'Width', heightPx: 'Height', densityDpi: 'Density (dpi)',
  xdpi: 'X dpi', ydpi: 'Y dpi', refreshHz: 'Refresh rate', level: 'Level', charging: 'Charging',
  technology: 'Technology', health: 'Health', temperatureC: 'Temperature', voltageMv: 'Voltage',
  operator: 'Operator', country: 'Country', simState: 'SIM state', phoneType: 'Phone type',
  telephony: 'Telephony', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', nfc: 'NFC',
  usbHost: 'USB host', name: 'Sensor', vendor: 'Vendor', type: 'Type', powerMa: 'Power (mA)',
  maxRange: 'Max range', resolution: 'Resolution', id: 'Id', facing: 'Facing', maxJpeg: 'Max JPEG',
  flash: 'Flash', supportedAbis: 'Supported ABIs',
};

export function label(key) {
  return LABELS[key] || key.replace(/([A-Z]+)/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

// "ramTotalGb" -> "4.0 GB"
function fmtVal(key, v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v === null || v === undefined || v === '') return null;
  if (key.endsWith('Gb') && typeof v === 'number') return `${v} GB`;
  if (key === 'refreshHz') return `${Math.round(v)} Hz`;
  if (key === 'temperatureC') return `${v} °C`;
  if (key === 'voltageMv') return `${v} mV`;
  if (key === 'densityDpi' || key === 'widthPx' || key === 'heightPx') return `${v} px`.replace(' px', key === 'densityDpi' ? ' dpi' : ' px');
  return String(v);
}

function Row({ k, v, chip = false, ok = null }) {
  const val = fmtVal(k, v);
  if (val === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-space-600/50 py-1.5 last:border-0">
      <span className="flex-none font-mono text-[10px] uppercase tracking-wider text-slate-500">{label(k)}</span>
      {ok !== null ? (
        ok ? <span className="chip-ok"><Check className="h-3 w-3" /> supported</span>
          : <span className="inline-flex items-center gap-1 border border-slate-700 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-600"><Minus className="h-3 w-3" /> missing</span>
      ) : (
        <span className={`break-all text-right font-mono text-[11px] ${chip ? 'text-neon' : 'text-slate-200'}`}>{val}</span>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="border-2 border-space-600 bg-space-800/60 p-3">
      <h5 className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-[0.22em] text-neon-dim">
        <Icon className="h-3.5 w-3.5 flex-none" /> {title}
      </h5>
      {children}
    </section>
  );
}

function Bar({ used, total, color = 'bg-neon' }) {
  if (!total) return null;
  const pct = Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100)));
  return (
    <div className="mt-1 h-1.5 w-full border border-space-600 bg-space-900">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function HardwareList({ hardware }) {
  const rootRef = useRef(null);
  const [showAllSensors, setShowAllSensors] = useState(false);
  useEffect(() => {
    revealChildren(rootRef.current, { selector: 'section', y: 14 });
  }, [hardware]);

  useEffect(() => popIn(rootRef.current), []);

  if (!hardware || typeof hardware !== 'object') {
    return <p className="font-mono text-xs text-slate-500">No hardware report posted yet by this device.</p>;
  }

  const screen = typeof hardware.screen === 'object' && hardware.screen ? hardware.screen : null;
  const battery = typeof hardware.battery === 'object' && hardware.battery ? hardware.battery : null;
  const telephony = typeof hardware.telephony === 'object' && hardware.telephony ? hardware.telephony : null;
  const features = typeof hardware.features === 'object' && hardware.features ? hardware.features : null;
  const sensors = Array.isArray(hardware.sensors) ? hardware.sensors : [];
  const cameras = Array.isArray(hardware.cameras) ? hardware.cameras : [];
  const abis = Array.isArray(hardware.supportedAbis) ? hardware.supportedAbis : [];
  const ramUsed = hardware.ramTotalGb != null && hardware.ramAvailableGb != null
    ? Math.round((hardware.ramTotalGb - hardware.ramAvailableGb) * 10) / 10 : null;
  const sensorsShown = showAllSensors ? sensors : sensors.slice(0, 6);

  return (
    <div ref={rootRef} className="grid gap-3 sm:grid-cols-2">
      <Section icon={Smartphone} title="Identity">
        {['model', 'brand', 'manufacturer', 'device', 'product', 'board', 'hardware'].map((k) => (
          <Row key={k} k={k} v={hardware[k]} />
        ))}
      </Section>

      <Section icon={Settings2} title="Android build">
        {['androidVersion', 'sdkInt', 'buildId', 'securityPatch', 'bootloader', 'radioVersion', 'kernelVersion', 'appVersion'].map((k) => (
          <Row key={k} k={k} v={hardware[k]} />
        ))}
        {hardware.fingerprint && (
          <Row k="fingerprint" v={String(hardware.fingerprint).slice(0, 58) + (String(hardware.fingerprint).length > 58 ? '…' : '')} />
        )}
      </Section>

      <Section icon={MemoryStick} title="Memory & storage">
        <div className="py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">RAM used / total</span>
            <span className="font-mono text-[11px] text-neon">
              {ramUsed != null ? `${ramUsed} GB / ${hardware.ramTotalGb} GB` : '—'}
            </span>
          </div>
          <Bar used={hardware.ramAvailableGb} total={hardware.ramTotalGb} />
        </div>
        <div className="py-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex-none font-mono text-[10px] uppercase tracking-wider text-slate-500">Storage free</span>
            <span className="font-mono text-[11px] text-neon">
              {hardware.storageFreeGb != null ? `${hardware.storageFreeGb} GB / ${hardware.storageTotalGb ?? '?'} GB` : '—'}
            </span>
          </div>
          <Bar used={hardware.storageFreeGb} total={hardware.storageTotalGb} color="bg-cyan-400" />
        </div>
        <Row k="lowRamDevice" v={hardware.lowRamDevice} />
      </Section>

      <Section icon={BatteryCharging} title="Battery">
        {battery ? (
          <>
            <Row k="level" v={`${battery.level != null ? battery.level : '—'} %`} chip />
            <Row k="charging" v={battery.charging} />
            <Row k="health" v={battery.health} chip />
            <Row k="technology" v={battery.technology} />
            <Row k="temperatureC" v={battery.temperatureC} />
            <Row k="voltageMv" v={battery.voltageMv} />
          </>
        ) : <p className="font-mono text-[11px] text-slate-500">No battery data.</p>}
      </Section>

      <Section icon={MonitorSmartphone} title="Display">
        {screen ? (
          <>
            <Row k="resolution" v={`${screen.widthPx} × ${screen.heightPx} px`} chip />
            <Row k="densityDpi" v={screen.densityDpi} />
            <Row k="refreshHz" v={screen.refreshHz} />
            <Row k="xdpi" v={screen.xdpi} />
            <Row k="ydpi" v={screen.ydpi} />
          </>
        ) : <p className="font-mono text-[11px] text-slate-500">No display data.</p>}
      </Section>

      <Section icon={Wifi} title="Network & SIM">
        <Row k="network" v={hardware.network} chip />
        {telephony && (
          <>
            <Row k="operator" v={telephony.operator} />
            <Row k="country" v={telephony.country} />
            <Row k="simState" v={telephony.simState} />
            <Row k="phoneType" v={telephony.phoneType} />
          </>
        )}
      </Section>

      <Section icon={Cpu} title="CPU">
        <Row k="supportedAbis" v={abis.join(', ')} chip />
      </Section>

      <Section icon={ListChecks} title="Features">
        <div className="flex flex-wrap gap-1.5 py-1.5">
          {features && Object.entries(features).map(([k, v]) => (
            v
              ? <span key={k} className="chip-ok"><Check className="h-3 w-3" /> {label(k)}</span>
              : <span key={k} className="inline-flex items-center gap-1 border border-slate-700 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-600"><Minus className="h-3 w-3" /> {label(k)}</span>
          ))}
          {!features && <span className="font-mono text-[11px] text-slate-500">No feature snapshot.</span>}
        </div>
      </Section>

      <Section icon={Camera} title={`Cameras${cameras.length ? ` (${cameras.length})` : ''}`}>
        {cameras.length === 0 ? <p className="font-mono text-[11px] text-slate-500">No camera data.</p> : cameras.map((c, i) => (
          <Row key={i} k={c.facing === 'front' ? 'Front camera' : c.facing === 'back' ? 'Back camera' : `Camera ${c.id ?? i}`}
            v={`${c.maxJpeg ?? '?'}${c.flash ? ' · flash' : ''}`} chip />
        ))}
      </Section>

      <Section icon={Radar} title={`Sensors${hardware.sensorCount ? ` (${hardware.sensorCount})` : ''}`}>
        {sensors.length === 0 ? <p className="font-mono text-[11px] text-slate-500">No sensor data.</p> : (
          <>
            {sensorsShown.map((s, i) => (
              <Row key={i} k={s.name || `sensor-${i}`} v={`${s.vendor || '—'} · ${s.powerMa ?? '?'} mA`} />
            ))}
            {sensors.length > 6 && (
              <button onClick={() => setShowAllSensors((v) => !v)}
                className="mt-1 flex w-full items-center justify-center gap-1 border-2 border-space-600 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 hover:border-neon hover:text-neon">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAllSensors ? 'rotate-180' : ''}`} />
                {showAllSensors ? 'Show less' : `Show all ${sensors.length} sensors`}
              </button>
            )}
          </>
        )}
      </Section>

      <div className="sm:col-span-2 flex items-center justify-between border border-space-600/60 bg-space-900/50 px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-slate-600">
        <span className="inline-flex items-center gap-1.5"><HardDrive className="h-3 w-3" /> report snapshot</span>
        <span><CircuitBoard className="mr-1 inline h-3 w-3" />{fmtVal('generatedAt', hardware.generatedAt) || '—'}</span>
      </div>
    </div>
  );
}
