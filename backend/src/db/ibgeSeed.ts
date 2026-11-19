import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbClient, getDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedFilePath = path.resolve(__dirname, '../../sql/seed_ibge_municipios.json');

export interface IbgeMunicipalityRecord {
  code: number;
  name: string;
  uf: string;
  state: string;
}

export async function seedIbgeMunicipalitiesIfEmpty(db: DbClient = getDb()): Promise<number> {
  const countRes = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM ibge_municipalities');
  const current = Number(countRes.rows[0]?.cnt || 0);
  if (current >= 5500) {
    return current;
  }

  if (!fs.existsSync(seedFilePath)) {
    return current;
  }

  const raw = fs.readFileSync(seedFilePath, 'utf8').replace(/^\uFEFF/, '');
  const list = JSON.parse(raw) as IbgeMunicipalityRecord[];
  return upsertIbgeMunicipalities(list, db);
}

export async function upsertIbgeMunicipalities(
  list: IbgeMunicipalityRecord[],
  db: DbClient = getDb()
): Promise<number> {
  const valid = list.filter((m) => m && m.code && m.name && m.uf && m.state);
  const chunkSize = 250;

  await db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i += chunkSize) {
      const chunk = valid.slice(i, i + chunkSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      chunk.forEach((m, idx) => {
        const base = idx * 4;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, NOW())`);
        values.push(Number(m.code), m.name.trim(), m.uf.trim().toUpperCase(), m.state.trim());
      });

      await tx.query(
        `INSERT INTO ibge_municipalities (ibge_code, name, uf, state_name, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (ibge_code) DO UPDATE SET
           name = EXCLUDED.name,
           uf = EXCLUDED.uf,
           state_name = EXCLUDED.state_name,
           updated_at = NOW()`,
        values
      );
    }
  });

  return valid.length;
}

export async function syncIbgeFromOfficialApi(db: DbClient = getDb()): Promise<{ total: number; source: string }> {
  const url = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`IBGE retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as Array<{
      id: number;
      nome: string;
      microrregiao?: { mesorregiao?: { UF?: { sigla: string; nome: string } } };
      'regiao-imediata'?: { 'regiao-intermediaria'?: { UF?: { sigla: string; nome: string } } };
    }>;

    const records: IbgeMunicipalityRecord[] = data
      .map((item) => {
        const ufObj =
          item.microrregiao?.mesorregiao?.UF ||
          item['regiao-imediata']?.['regiao-intermediaria']?.UF;
        if (!ufObj) return null;
        return {
          code: Number(item.id),
          name: item.nome,
          uf: ufObj.sigla,
          state: ufObj.nome,
        };
      })
      .filter((x): x is IbgeMunicipalityRecord => x !== null);

    const total = await upsertIbgeMunicipalities(records, db);
    return { total, source: 'IBGE API Oficial' };
  } finally {
    clearTimeout(timer);
  }
}
