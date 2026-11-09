// A preview of a bot's avatar: its shape and colour with two eyes, optionally showing the state its
// device shows (idle breathes, thinking has dots orbiting, offline closes its eyes…). An approximation
// for choosing settings; the device draws its own.
import type { CSSProperties } from 'react';
import type { Avatar as AvatarSettings } from '@/api.ts';

function superellipse(r: number, n = 4, steps = 64): string {
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = 50 + r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = 52 + r * Math.sign(s) * Math.abs(s) ** (2 / n);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

function blob(steps = 72): string {
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const r = 40 + 3 * Math.sin(3 * t + 0.6) + 2 * Math.sin(5 * t + 1.9);
    points.push(`${(50 + r * Math.cos(t)).toFixed(2)},${(52 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function Body({ shape, color }: AvatarSettings) {
  switch (shape) {
    case 'circle':
      return <circle cx="50" cy="52" r="40" fill={color} />;
    case 'squircle':
      return <path d={superellipse(40)} fill={color} />;
    case 'hex':
      return <polygon points="50,16 81,34 81,70 50,88 19,70 19,34" fill={color} stroke={color} strokeWidth="10" strokeLinejoin="round" />;
    case 'teardrop':
      return <path d="M50 8 C 62 26, 88 42, 88 60 A 38 38 0 0 1 12 60 C 12 42, 38 26, 50 8 Z" fill={color} />;
    case 'cloud':
      return (
        <g fill={color}>
          <circle cx="31" cy="58" r="20" />
          <circle cx="52" cy="44" r="25" />
          <circle cx="71" cy="58" r="19" />
          <rect x="22" y="56" width="58" height="26" rx="13" />
        </g>
      );
    default:
      return <path d={blob()} fill={color} />;
  }
}

export type AvatarState = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'offline';

const LABELS: Record<AvatarState, string> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  waiting: 'waiting for you',
  error: 'error',
  offline: 'offline',
};

export function Avatar({ avatar, size = 96, state }: { avatar: AvatarSettings; size?: number; state?: AvatarState }) {
  const eyes = luminance(avatar.color) > 0.6 ? '#1f2937' : '#ffffff';
  const offline = state === 'offline';
  const look = state === 'thinking' ? -5 : 0; // thinking looks up
  const orbit = state === 'thinking' || state === 'working';
  const motion = (name: string, seconds: number, extra = ''): CSSProperties => ({
    animation: `${name} ${seconds}s ${extra || 'ease-in-out'} infinite`,
    transformOrigin: '50px 52px',
    transformBox: 'view-box',
  });
  return (
    <svg
      width={size}
      height={size}
      style={{ width: size, height: size }} // wins over containers that size icons (toggle buttons)
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${avatar.shape} avatar${state ? `, ${LABELS[state]}` : ''}`}
      className="avatar-motion shrink-0 overflow-visible"
    >
      {state === 'waiting' && (
        <circle cx="50" cy="52" r="47" fill="none" stroke={avatar.color} strokeWidth="2.5" style={motion('avatar-pulse', 1.6)} />
      )}
      {state === 'error' && <circle cx="50" cy="52" r="47" fill="none" stroke="var(--destructive)" strokeWidth="3" />}
      <g style={state === 'idle' ? motion('avatar-breathe', 4) : undefined} opacity={offline ? 0.45 : 1}>
        <Body {...avatar} />
        {offline ? (
          <>
            <rect x="34" y="50" width="12" height="3" rx="1.5" fill={eyes} />
            <rect x="54" y="50" width="12" height="3" rx="1.5" fill={eyes} />
          </>
        ) : (
          <g transform={`translate(0 ${look})`}>
            <rect x="36" y="38" width="8" height="18" rx="4" fill={eyes} />
            <rect x="56" y="38" width="8" height="18" rx="4" fill={eyes} />
          </g>
        )}
      </g>
      {orbit && (
        <g style={motion('avatar-orbit', state === 'working' ? 1.2 : 2.4, 'linear')}>
          {[0, 120, 240].map((deg) => (
            <circle
              key={deg}
              cx={50 + 47 * Math.cos((deg * Math.PI) / 180)}
              cy={52 + 47 * Math.sin((deg * Math.PI) / 180)}
              r="3.2"
              fill={avatar.color}
            />
          ))}
        </g>
      )}
    </svg>
  );
}

/** The device state the bridge reports, as an avatar state. */
export function avatarState(showing: string | null, online: boolean): AvatarState {
  if (!online) return 'offline';
  return showing === 'thinking' || showing === 'working' || showing === 'waiting' || showing === 'error' ? showing : 'idle';
}
