import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create schema if not exists
  await knex.raw("IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'bridge') EXEC('CREATE SCHEMA bridge')");

  // Create table
  return knex.schema.withSchema("bridge").createTable("customer_demo", (table) => {
    table.increments("id").primary();
    table.string("name", 200).notNullable();
    table.string("phone", 50).nullable();
    table.dateTime("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.withSchema("bridge").dropTableIfExists("customer_demo");
}
