import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/dnd_gaming_hub'),
  SESSION_SECRET: z.string().default('dev_secret_key_minimum_length_required_32_chars'),
  MOCK_WEBHOOK_SECRET: z.string().default('dev_mock_webhook_secret_key_32_chars'),
  // Email transport (all optional — dev uses console stub, test uses in-memory mock)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587').transform((val) => parseInt(val, 10)),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z
    .string()
    .default('"DND Gaming Hub" <noreply@dndgaming.com>'),
  TZ: z.string().default('Asia/Kolkata')
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
