import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  next: <path d="M5 5v14l10-7zM17 5h2.5v14H17z" fill="currentColor" stroke="none" />,
  back: <path d="M11 7 6 12l5 5M6 12h9a4 4 0 0 1 4 4v1" />,
  fwd: <path d="m13 7 5 5-5 5M18 12H9a4 4 0 0 0-4 4v1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
  starOn: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  file: <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.500 1.500 0 0 1 6 19V5a1.500 1.500 0 0 1 1-1.500zM14 3.500V8h4" />,
  refresh: <path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300M19.500 4.500v4h-4" />,
  screen: <><rect x="3" y="4.500" width="18" height="12" rx="1.500" /><path d="M8.500 20h7M12 16.500V20" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800" /></>,
  vol: <path d="M4 9.500v5h3.500l4.500 4v-13l-4.500 4zM15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3" /></>,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="2.600" />,
  trash: <path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l1 12.500h9l1-12.500" />,
  check: <path d="m5 12.500 4.500 4.500L19 7.500" />,
  undo: <path d="M8 5 4 9l4 4M4 9h10a5 5 0 0 1 0 10h-3" />,
  globe: <><circle cx="12" cy="12" r="8.500" /><path d="M3.500 12h17M12 3.500c3 3 3 14 0 17M12 3.500c-3 3-3 14 0 17" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.2" /><path d="M11 17.5h2" /></>,
  qr: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z" />,
  link: <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Logo() {
  return (
    <div className="logo">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <rect x="12.5" y="6" width="7" height="12" rx="3.5" fill="var(--on-accent)" />
        <path d="M9 15.5a7 7 0 0 0 14 0M16 22.5V26" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </svg>
      <span>KARAOKE<b>PRO</b></span>
    </div>
  );
}
