import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import * as api from '../api';
import {
  discardLegacyData,
  readLegacyData,
  wasLegacyImported,
  type LegacyPerson,
  type LegacySnapshot,
} from '../db';
import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../lib/money';
import type { Assignment, Receipt } from '../types';

/**
 * Recovery of the previous version's receipts, stored locally.
 *
 * Deliberately throwaway code, and isolated so that it can be: it only has a
 * reason to exist for users who already had receipts before those moved to the
 * server side. Offered once, then forgotten.
 *
 * Matching the old participants with the tricount's members is done by name —
 * exactly the fragility the rework gets rid of, but here there is no other
 * clue. Whatever does not match is **left out of the assignment** rather than
 * attached at random: a line with no owner is visible and gets corrected, a
 * line assigned to the wrong person is not.
 */

type LegacyLine = {
  id?: string;
  label?: string;
  description?: string | null;
  quantity?: number;
  unitPriceCents?: number;
  totalCents?: number;
  taxCodes?: string[] | null;
  assignments?: { personId?: string; shares?: number }[];
  confidence?: number;
  isManual?: boolean;
};

type LegacyReceipt = {
  id?: string;
  createdAt?: string;
  merchant?: string | null;
  purchaseDate?: string | null;
  lines?: LegacyLine[];
  taxes?: unknown[];
  adjustments?: unknown[];
  statedSubtotalCents?: number | null;
  statedTotalCents?: number | null;
  tipCents?: number;
  tipBasis?: 'subtotal' | 'total';
  status?: 'draft' | 'settled';
};

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Old person identifier → uuid of the member with the same name, when there is one. */
function buildNameMap(
  people: LegacyPerson[],
  members: { uuid: string; displayName: string }[],
): Map<string, string> {
  const byName = new Map(members.map((member) => [normalizeName(member.displayName), member.uuid]));
  const mapping = new Map<string, string>();
  for (const person of people) {
    const uuid = byName.get(normalizeName(person.name));
    if (uuid) mapping.set(person.id, uuid);
  }
  return mapping;
}

function convertAssignments(
  assignments: LegacyLine['assignments'],
  mapping: Map<string, string>,
): Assignment[] {
  const converted: Assignment[] = [];
  for (const assignment of assignments ?? []) {
    const uuid = assignment.personId ? mapping.get(assignment.personId) : undefined;
    if (uuid) converted.push({ personId: uuid, shares: assignment.shares ?? 1 });
  }
  return converted;
}

function totalOf(receipt: LegacyReceipt): number {
  const sum = (items: unknown[] | undefined, key: string) =>
    (items ?? []).reduce(
      (acc: number, item) => acc + Number((item as Record<string, unknown>)[key] ?? 0),
      0,
    );
  return (
    (receipt.lines ?? []).reduce((acc, line) => acc + (line.totalCents ?? 0), 0) +
    sum(receipt.taxes, 'amountCents') +
    sum(receipt.adjustments, 'amountCents')
  );
}

export function LegacyImport() {
  const groups = useAppStore((s) => s.groups);
  const refreshGroups = useAppStore((s) => s.refreshGroups);
  const online = useAppStore((s) => s.online);

  const [snapshot, setSnapshot] = useState<LegacySnapshot | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (await wasLegacyImported()) return;
      setSnapshot(await readLegacyData());
    })();
  }, []);

  if (!snapshot) return null;

  const activeTarget = groups.some((group) => group.id === target) ? target : (groups[0]?.id ?? '');

  const runImport = async () => {
    if (activeTarget === '') return;
    setBusy(true);
    setReport(null);
    try {
      const group = await api.readGroup(activeTarget);
      const mapping = buildNameMap(snapshot.people, group.members);

      let imported = 0;
      let orphaned = 0;
      for (const raw of snapshot.receipts as LegacyReceipt[]) {
        const created = await api.createReceipt(activeTarget);
        const lines = (raw.lines ?? []).map((line) => {
          const assignments = convertAssignments(line.assignments, mapping);
          if ((line.assignments ?? []).length > 0 && assignments.length === 0) orphaned += 1;
          return {
            id: line.id ?? crypto.randomUUID(),
            label: line.label ?? 'Article',
            description: line.description ?? null,
            quantity: line.quantity ?? 1,
            unitPriceCents: line.unitPriceCents ?? 0,
            totalCents: line.totalCents ?? 0,
            taxCodes: line.taxCodes ?? null,
            assignments,
            confidence: line.confidence ?? 100,
            isManual: line.isManual ?? false,
          };
        });

        const receipt: Receipt = {
          ...created,
          merchant: raw.merchant ?? null,
          purchaseDate: raw.purchaseDate ?? null,
          lines,
          taxes: (raw.taxes ?? []) as Receipt['taxes'],
          adjustments: ((raw.adjustments ?? []) as Receipt['adjustments']).map((adjustment) => ({
            ...adjustment,
            assignments: convertAssignments(
              adjustment.assignments as LegacyLine['assignments'],
              mapping,
            ),
          })),
          statedSubtotalCents: raw.statedSubtotalCents ?? null,
          statedTotalCents: raw.statedTotalCents ?? null,
          tipCents: raw.tipCents ?? 0,
          tipBasis: raw.tipBasis ?? 'subtotal',
          status: raw.status ?? 'draft',
          step: 'verify',
        };
        await api.writeReceipt(receipt);
        imported += 1;
      }

      await discardLegacyData();
      await refreshGroups();
      setSnapshot(null);
      setReport(
        orphaned > 0
          ? `${imported} ticket(s) importé(s). ${orphaned} ligne(s) ont perdu leur attribution : leurs participants n'ont pas d'équivalent dans le tricount.`
          : `${imported} ticket(s) importé(s).`,
      );
    } catch (error) {
      setReport(error instanceof Error ? error.message : "L'import a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    void discardLegacyData();
    setSnapshot(null);
  };

  const totalCents = (snapshot.receipts as LegacyReceipt[]).reduce(
    (sum, receipt) => sum + totalOf(receipt),
    0,
  );

  return (
    <>
      <Sheet
        open
        title="Tickets de l’ancienne version"
        onClose={skip}
        footer={
          <div className="row row--gap">
            <Button full onClick={skip}>
              Ne pas importer
            </Button>
            <Button
              variant="primary"
              full
              disabled={busy || !online || activeTarget === ''}
              onClick={() => void runImport()}
            >
              {busy ? 'Import…' : 'Importer'}
            </Button>
          </div>
        }
      >
        <p className="muted">
          Cet appareil conserve {snapshot.receipts.length} ticket
          {snapshot.receipts.length > 1 ? 's' : ''} de la version précédente, pour un total de{' '}
          <span className="num">{formatCents(totalCents)}</span>. Ils peuvent être versés dans
          un groupe.
        </p>

        {groups.length === 0 ? (
          <p className="warnText">
            Rejoignez d’abord un groupe : les tickets doivent aller quelque part. Cette
            proposition réapparaîtra tant que vous ne l’aurez pas écartée.
          </p>
        ) : (
          <label className="field">
            <span className="field__label">Verser dans</span>
            <select value={activeTarget} onChange={(event) => setTarget(event.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="muted">
          Les participants sont retrouvés par leur nom parmi les membres du tricount. Ceux qui
          n’y figurent pas laissent leurs lignes sans attribution — à reprendre sur l’écran
          d’attribution, où elles se voient.
        </p>
        <p className="muted">
          « Ne pas importer » efface définitivement ces anciennes données de cet appareil.
        </p>
      </Sheet>

      {report ? (
        <Sheet
          open
          title="Import terminé"
          onClose={() => setReport(null)}
          footer={
            <Button variant="primary" full onClick={() => setReport(null)}>
              Fermer
            </Button>
          }
        >
          <p className="muted">{report}</p>
        </Sheet>
      ) : null}
    </>
  );
}
