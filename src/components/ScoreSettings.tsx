// Configuração da nota do cantor: liga/desliga e escolhe de onde vem o som da voz.
import { startMics, useMics } from '../player/mics';
import { updateSettings, useApp } from '../store';

export function ScoreSettings() {
  const s = useApp((st) => st.settings);
  const mics = useMics();
  const mixerOn = mics.active.length > 0;
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={s.score} onChange={(e) => updateSettings({ score: e.target.checked })} /> Dar nota ao cantor no fim de cada música (aparece na tela do público)
      </label>
      <label className="inline">
        Microfone ouvido
        <select value={s.scoreMic} disabled={!s.score} onChange={(e) => updateSettings({ scoreMic: e.target.value })}>
          <option value="">{mixerOn ? 'Os microfones ligados no mixer do app' : 'Só os microfones do mixer do app'}</option>
          {mics.devices.map((d) => (
            <option key={d.id} value={d.id}>{d.label} (só para a nota)</option>
          ))}
        </select>
        {mics.status !== 'ready' && (
          <button type="button" className="btn sm" disabled={!s.score || mics.status === 'starting'} onClick={() => startMics()}>
            Detectar microfones
          </button>
        )}
      </label>
      <p className="hint">
        O app ouve a voz enquanto a música toca e avalia afinação (notas firmes e no lugar), presença (cantou a música toda) e expressão (variação de altura e
        intensidade). A nota vai de 60 a 100. Com microfones ligados no mixer do app, eles são usados; se os microfones vão para uma mesa de som externa,
        escolha acima uma entrada do computador que receba a voz. Sem voz suficiente (menos de 30 s de música ou de 8 s de canto), não há nota.
      </p>
    </>
  );
}
