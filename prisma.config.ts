import "dotenv/config"; // Prisma 7 no longer loads .env by itself
import { defineConfig, env } from "prisma/config";

// Prisma 7: the connection URL lives here, not in schema.prisma. Migrate and
// Studio read it from this file; the app passes the same URL to the SQLite
// driver adapter in src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
