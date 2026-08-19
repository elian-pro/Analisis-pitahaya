import { normalizeAdvisorName } from '../advisors/match';
import type { NormalizedCall } from './normalize';

// ─────────────────────────────────────────────────────────────────────────────
// De quién es una llamada.
//
// No se puede deducir del origen del webhook: advisors/match.ts documenta que
// dos clientes pueden compartir la misma fuente (mismo negocio, dos productos,
// dos equipos comerciales) y que el roster de asesores es lo único que los
// separa. Así que se resuelve por asesor, y el origen solo desempata.
//
// Recibe los rosters como dato en vez de cargarlos: advisors/store importa
// google/sheets, que arrastra config/env y su process.exit(1). Mismo motivo por
// el que match.ts vive aparte.
// ─────────────────────────────────────────────────────────────────────────────

export interface RosterEntry {
  clientId:      string;
  advisorNames:  string[];
  /** `callpicker_description` esperado ("ZD - Midstorage"), si está configurado. */
  callpickerTag?: string | null;
}

export type ResolveOutcome =
  | { clientId: string; via: 'roster' | 'tag' }
  | { clientId: null; motivo: 'sin_roster' | 'ambiguo' };

export function resolveClientId(call: NormalizedCall, rosters: RosterEntry[]): ResolveOutcome {
  const asesor = normalizeAdvisorName(call.asesor ?? '');
  if (!asesor) return { clientId: null, motivo: 'sin_roster' };

  const candidatos = rosters.filter(r =>
    r.advisorNames.some(n => normalizeAdvisorName(n) === asesor),
  );

  if (candidatos.length === 1) return { clientId: candidatos[0].clientId, via: 'roster' };
  if (candidatos.length === 0) return { clientId: null, motivo: 'sin_roster' };

  // Un asesor en varios rosters: es el caso real de dos productos con el mismo
  // equipo. El tag del origen es lo único que los distingue.
  const origen = (call.origen ?? '').trim().toLowerCase();
  if (origen) {
    const porTag = candidatos.filter(c => (c.callpickerTag ?? '').trim().toLowerCase() === origen);
    if (porTag.length === 1) return { clientId: porTag[0].clientId, via: 'tag' };
  }
  return { clientId: null, motivo: 'ambiguo' };
}
