import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const isAudience = new URLSearchParams(location.search).get('view') === 'audience';

// A tela do público não carrega o motor de reprodução nem os painéis administrativos.
if (isAudience) {
  import('./audience/AudienceView').then(({ AudienceView }) => root.render(<AudienceView />));
} else {
  import('./App').then(({ App }) => root.render(<App />));
}
