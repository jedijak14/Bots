import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  aiKeyEnc: text("ai_key_enc"),
  aiKeyHint: text("ai_key_hint"),
  aiProvider: text("ai_provider"),
  aiProviderMode: text("ai_provider_mode").notNull().default("auto"),
  aiBaseUrl: text("ai_base_url"),
  defaultModel: text("default_model"),
  e2bKeyEnc: text("e2b_key_enc"),
  e2bKeyHint: text("e2b_key_hint"),
  followMouse: boolean("follow_mouse").notNull().default(true),
  animations: boolean("animations").notNull().default(true),
  voiceReplies: boolean("voice_replies").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shape: text("shape").notNull().default("circle"),
    color: text("color").notNull().default("blue"),
    instructions: text("instructions").notNull().default(""),
    model: text("model"),
    sandboxId: text("sandbox_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bots_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull().default(""),
    steps: jsonb("steps").$type<StepRecord[]>(),
    choices: jsonb("choices").$type<ChoicesRecord>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_bot_idx").on(t.botId, t.createdAt), index("messages_user_idx").on(t.userId)],
);

export type StepRecord = {
  id: string;
  name: string;
  label: string;
  ok: boolean;
  output?: string;
};

export type ChoicesRecord = {
  question: string;
  options: string[];
};
