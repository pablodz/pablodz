/**
 * El motor de "La Máquina de la Humanidad": 3 EDOs acopladas
 *   C = cohesión / cooperación
 *   W = excedente / riqueza
 *   G = concentración / desigualdad
 * Integradas con Runge-Kutta 4. Compartido por los componentes interactivos.
 */

export interface Params {
  b: number; r0: number; gamma: number; lam: number; a: number; K: number;
  mu: number; zeta: number; tau: number; kc: number; omega: number;
  psi: number; eta: number; seed: number;
}

export const BASE: Params = {
  b: 2.2, r0: 0.35, gamma: 0.55, lam: 2.4, a: 1.1, K: 10, mu: 0.1,
  zeta: 0.32, tau: 0.04, kc: 1.3, omega: 2.5, psi: 3.2, eta: 0.015, seed: 0.02,
};

export type State = [number, number, number];

export function deriv(s: State, P: Params): State {
  const [C, W, G] = s;
  const r = P.r0 + (1 - P.r0) * C;
  const net = P.b * r - P.gamma - P.lam * G;
  const Phi = G * G * (1 - C);
  return [
    P.kc * C * (1 - C) * net - P.omega * Phi * C + P.eta * (1 - C),
    P.a * C * W * (1 - W / P.K) - P.mu * W - P.psi * Phi * W + P.seed,
    P.zeta * (W / P.K) * (1 - G) - P.tau * G - 1.5 * P.psi * Phi * G,
  ];
}

export function rk4(s: State, P: Params, dt: number): State {
  const a = deriv(s, P);
  const b = deriv([s[0] + dt / 2 * a[0], s[1] + dt / 2 * a[1], s[2] + dt / 2 * a[2]], P);
  const c = deriv([s[0] + dt / 2 * b[0], s[1] + dt / 2 * b[1], s[2] + dt / 2 * b[2]], P);
  const d = deriv([s[0] + dt * c[0], s[1] + dt * c[1], s[2] + dt * c[2]], P);
  return [
    Math.max(0, Math.min(1, s[0] + dt / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]))),
    Math.max(1e-4, s[1] + dt / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1])),
    Math.max(0, Math.min(1, s[2] + dt / 6 * (a[2] + 2 * b[2] + 2 * c[2] + d[2]))),
  ];
}

export function simulate(P: Params, steps: number, dt: number): number[][] {
  let s: State = [0.35, 0.4, 0.05];
  const out: number[][] = [];
  for (let i = 0; i < steps; i++) {
    s = rk4(s, P, dt);
    out.push([s[0], s[1], s[2], s[0] * s[1]]);
  }
  return out;
}

/** Paleta del blog (NERV) para los canvas. */
export const COL = {
  orange: '#ed8d4c',
  orangeBright: '#ffa45c',
  green: '#52d053',
  purple: '#765898',
  yellow: '#ffcc33',
  red: '#ff0000',
  blue: '#33b7db',
  muted: '#8f8b83',
  grid: 'rgba(255,255,255,0.07)',
};

/** Helper: prepara un canvas con DPR y devuelve {ctx,w,h}. */
export function ctxOf(cv: HTMLCanvasElement, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || cv.parentElement!.clientWidth;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const x = cv.getContext('2d')!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, w, h };
}
