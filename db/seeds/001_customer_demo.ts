import { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex("bridge.customer_demo").del();

  // Inserts seed entries
  await knex("bridge.customer_demo").insert([
    { name: "John Doe", phone: "+1234567890" },
    { name: "Jane Smith", phone: "+0987654321" },
  ]);
}
