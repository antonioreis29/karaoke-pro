import { channelCfg, setChannel, setFx, startMics, useMics } from '../player/mics';
import { useApp } from '../store';
import { Icon } from './icons';

function Knob({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="fx">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} onDoubleClick={() => onChange(label === 'Volume' ? 1 : 0)} />
      <b>{format(value)}</b>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

export function MicMixer() {
  const mics = useMics();
  const cfg = useApp((s) => s.settings.mics);

  if (mics.status === 'off' || mics.status === 'starting') {
    return (
      <div className="mic-empty">
        <Icon name="mic" size={22} />
        <div>
          <strong>Mixer de microfones</strong>
          <p>Detecta os microfones ligados a este computador e envia a voz para a saída de som, com volume, grave, agudo e eco.</p>
        </div>
        <button className="btn primary" onClick={() => startMics()} disabled={mics.status === 'starting'}>
          {mics.status === 'starting' ? 'Procurando…' : 'Detectar microfones'}
        </button>
      </div>
    );
  }
  if (mics.status !== 'ready') {
    return (
      <div className="mic-empty">
        <Icon name="mic" size={22} />
        <div>
          <strong>{mics.status === 'denied' ? 'Acesso ao microfone bloqueado' : 'Microfones indisponíveis'}</strong>
          <p>
            {mics.status === 'denied'
              ? 'Libere em Configurações do Windows › Privacidade e segurança › Microfone (permitir aplicativos da área de trabalho) e tente de novo.'
              : mics.error || 'Este ambiente não oferece acesso a dispositivos de áudio.'}
          </p>
        </div>
        <button className="btn" onClick={() => startMics()}>Tentar de novo</button>
      </div>
    );
  }

  return (
    <div className="mics">
      <div className="mic-list">
        {mics.devices.length === 0 && <p className="hint">Nenhum microfone conectado. Ligue um microfone e ele aparece aqui sozinho.</p>}
        {mics.devices.map((d) => {
          const c = channelCfg(d.id);
          const live = mics.active.includes(d.id);
          const level = live && !c.muted ? mics.levels[d.id] ?? 0 : 0;
          const fail = mics.failed[d.id];
          return (
            <div key={d.id} className={`mic ${live ? 'live' : ''}`}>
              <button className={`switch ${c.on ? 'on' : ''}`} onClick={() => setChannel(d.id, { on: !c.on })} title={c.on ? 'Desligar este microfone' : 'Ligar este microfone'} role="switch" aria-checked={c.on}>
                <i />
              </button>
              <div className="mic-main">
                <div className="mic-name" title={d.label}>
                  {d.label}
                  {fail && c.on && <span className="badge danger">{fail}</span>}
                </div>
                <div className="meter" aria-hidden="true">
                  <i style={{ width: '100%', transform: `scaleX(${Math.min(1, Math.sqrt(level))})` }} className={level > 0.9 ? 'clip' : ''} />
                </div>
              </div>
              <input className="mic-gain" type="range" min={0} max={1.5} step={0.01} value={c.gain} disabled={!c.on} onChange={(e) => setChannel(d.id, { gain: +e.target.value })} title="Volume deste microfone" />
              <b className="mic-val">{pct(c.gain)}</b>
              <button className={`ghost mute ${c.muted ? 'on' : ''}`} onClick={() => setChannel(d.id, { muted: !c.muted })} disabled={!c.on} title={c.muted ? 'Reativar o som' : 'Silenciar'}>
                <Icon name={c.muted ? 'x' : 'vol'} size={15} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mic-fx">
        <Knob label="Volume" value={cfg.volume} min={0} max={1.5} step={0.01} onChange={(v) => setFx({ volume: v })} format={pct} />
        <Knob label="Eco" value={cfg.echo} min={0} max={0.8} step={0.01} onChange={(v) => setFx({ echo: v })} format={pct} />
        <Knob label="Graves" value={cfg.bass} min={-12} max={12} step={1} onChange={(v) => setFx({ bass: v })} format={db} />
        <Knob label="Agudos" value={cfg.treble} min={-12} max={12} step={1} onChange={(v) => setFx({ treble: v })} format={db} />
      </div>
      {mics.active.length > 0 && (
        <p className="hint mic-note">
          Atraso estimado de {mics.latencyMs || '?'} ms. Se der microfonia, afaste o microfone das caixas ou baixe o volume.
        </p>
      )}
    </div>
  );
}
