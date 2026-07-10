/** Prefija una ruta con el base path del sitio (/pablodz en GitHub Pages). */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function formatDate(date: Date): string {
  return date
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '.');
}

/** 3 → "03" para los números de episodio. */
export function pad(n: number): string {
  return String(n).padStart(2, '0');
}
