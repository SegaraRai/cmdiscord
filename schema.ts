import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";

export const zDiscordEnvObject = z.object({
  DISCORD_TOKEN: z.string(),
  DISCORD_GUILD_ID: z.string(),
});

export const zCommandOption = z.object({
  name: z.string().regex(/^[\w-]{1,32}$/),
  description: z.string().optional(),
  default: z.string().optional(),
  // regex: z.string().optional(),
});

export const zCommand = z.object({
  name: z.string().regex(/^[\w-]{1,32}$/),
  description: z.string().optional(),
  command: z.string(),
  options: zCommandOption.array().optional(),
  workingDirectory: z.string().optional(),
  env: z.record(z.string()).optional(),
  stdin: z.string().optional(),
  outputTemplate: z
    .union([
      z.string(),
      z.object({
        success: z.string(),
        error: z.string(),
      }),
    ])
    .optional(),
});

export const zConfig = z.object({
  name: z.string(),
  env: z.union([z.literal("dotenv"), zDiscordEnvObject]).optional(),
  commands: zCommand.array(),
});
