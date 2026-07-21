import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ticketree:ticketree@localhost:5433/ticketree',
  },
  verbose: true,
  strict: true,
})
