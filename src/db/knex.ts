import knex, { Knex } from "knex";
import config from "../../knexfile.js";

const environment = process.env.NODE_ENV || "development";
const knexConfig = config[environment];

export const db: Knex = knex(knexConfig);

export async function dbPing(): Promise<{ ok: boolean }> {
  try {
    await db.raw("SELECT 1 as ok");
    return { ok: true };
  } catch (error) {
    throw new Error(`Database ping failed: ${error}`);
  }
}
