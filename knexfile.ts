import { Knex } from "knex";
import * as dotenv from "dotenv";

dotenv.config();

const baseConfig: Knex.Config = {
  client: process.env.DB_CLIENT || "mssql",
  connection: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "1433"),
    user: process.env.DB_USER || "sa",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "",
    options: {
      encrypt: process.env.DB_ENCRYPT === "true",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== "false",
    },
  },
  pool: {
    min: parseInt(process.env.DB_POOL_MIN || "0"),
    max: parseInt(process.env.DB_POOL_MAX || "10"),
  },
  migrations: {
    directory: "./db/migrations",
    extension: "ts",
  },
  seeds: {
    directory: "./db/seeds",
    extension: "ts",
  },
};

const config: { [key: string]: Knex.Config } = {
  development: baseConfig,
  production: baseConfig,
};

export default config;
