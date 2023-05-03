import {
  ApplicationCommandOptionTypes,
  CreateSlashApplicationCommand,
  InteractionResponseTypes,
  createBot,
  startBot,
} from "discordeno";
import * as dotenv from "std/dotenv/mod.ts";
import * as flags from "std/flags/mod.ts";
import * as toml from "std/toml/mod.ts";
import * as yaml from "std/yaml/mod.ts";
import { z } from "zod";

import { zCommand, zConfig } from "./schema.ts";
import {
  formatCommand,
  formatOutput,
  prettyArgs,
  splitCommands,
} from "./utils.ts";

const DEFAULT_OUTPUT_TEMPLATE = "{output}";

interface CommandData {
  config: z.infer<typeof zCommand>;
  commands: readonly string[];
  applicationCommand: CreateSlashApplicationCommand;
}

// Parse args

const parsedArgs = flags.parse(Deno.args);
if (parsedArgs.help) {
  console.log(
    "Usage: deno run --allow-env --allow-net --allow-read --allow-run main.ts [--config <config file>] [--parser <parser>]"
  );
  Deno.exit(0);
}

// Load config

const configFiles = parsedArgs.config
  ? [parsedArgs.config]
  : ["./cmdiscord.yaml", "./cmdiscord.yml", "./cmdiscord.toml"];
const parsersFromArgs =
  parsedArgs.parser === "yaml"
    ? [yaml.parse]
    : parsedArgs.parser === "toml"
    ? [toml.parse]
    : null;
let rawConfig: unknown;
for (const configFile of configFiles) {
  const parsers =
    parsersFromArgs ||
    (/\.toml/i.test(configFile)
      ? [toml.parse, yaml.parse]
      : [yaml.parse, toml.parse]);
  try {
    const text = await Deno.readTextFile(configFile);
    for (const parse of parsers) {
      try {
        rawConfig = parse(text);
        break;
      } catch {
        continue;
      }
    }
    if (rawConfig == null) {
      throw new Error(`Failed to parse config file ${configFile}.`);
    }
    break;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      continue;
    }
    throw e;
  }
}
if (rawConfig == null) {
  throw new Error(`Failed to find config file.`);
}
const config = zConfig.parse(rawConfig);

// Create command map

const commandMap: ReadonlyMap<string, CommandData> = new Map(
  config.commands.map((config) => {
    // validate command
    formatCommand(config.command, (key) => {
      if (!config.options?.some((option) => option.name === key)) {
        throw new Error(`Command ${config.name} is missing option ${key}.`);
      }
      return "";
    });

    const commands = splitCommands(config.command);

    const applicationCommand: CreateSlashApplicationCommand = {
      name: config.name,
      description: config.description ?? config.command,
      options: config.options?.map((option) => ({
        name: option.name,
        description: option.description ?? `{${option.name}}`,
        type: ApplicationCommandOptionTypes.String,
        required: option.default != null,
      })),
    };

    return [
      config.name,
      {
        config,
        applicationCommand,
        commands,
      },
    ];
  })
);

// Load env

let env: Record<string, string> = {};
if (config.env === "dotenv") {
  env = {
    ...Deno.env.toObject(),
    ...(await dotenv.load()),
  };
} else if (typeof config.env === "object") {
  env = config.env;
} else {
  env = Deno.env.toObject();
}

const { DISCORD_TOKEN, DISCORD_GUILD_ID } = env;
if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is not set.");
}
if (!DISCORD_GUILD_ID) {
  throw new Error("DISCORD_GUILD_ID is not set.");
}

// Create bot

const bot = createBot({
  token: DISCORD_TOKEN,
  events: {
    ready: (_bot, payload) => {
      console.log(`${payload.user.username} is ready!`);
    },
  },
});

bot.events.interactionCreate = async (b, interaction) => {
  if (!interaction.data) {
    return;
  }

  const command = commandMap.get(interaction.data.name);
  if (!command) {
    return;
  }

  const promise = b.helpers.sendInteractionResponse(
    interaction.id,
    interaction.token,
    {
      type: InteractionResponseTypes.DeferredChannelMessageWithSource,
    }
  );

  // TODO: validate options
  const options = new Map(
    interaction.data.options?.map((option) => [
      option.name,
      typeof option.value !== "object" ? String(option.value) : null,
    ])
  );

  const commands = command.commands.map((arg) =>
    formatCommand(
      arg,
      (key) =>
        options.get(key) ??
        command.config.options?.find((option) => option.name === key)
          ?.default ??
        ""
    )
  );
  const strCommands = prettyArgs(commands);

  // TODO: post `strCommands` to audit log channel

  let process: Deno.Process | undefined;
  let content: string | undefined;
  try {
    process = Deno.run({
      cmd: commands,
      cwd: command.config.workingDirectory,
      stdout: "piped",
      stderr: "piped",
      stdin: command.config.stdin ? "piped" : "null",
    });

    if (command.config.stdin) {
      process.stdin?.write(new TextEncoder().encode(command.config.stdin));
    }

    const [status, stdout, stderr] = await Promise.all([
      process.status(),
      process.output(),
      process.stderrOutput(),
    ]);

    const template =
      typeof command.config.outputTemplate === "object"
        ? command.config.outputTemplate[status.success ? "success" : "error"]
        : command.config.outputTemplate ?? DEFAULT_OUTPUT_TEMPLATE;

    const decoder = new TextDecoder();
    content = formatOutput(
      template,
      decoder.decode(stdout),
      decoder.decode(stderr),
      strCommands
    );
  } catch (e) {
    content = String(e);
  } finally {
    process?.close();
  }

  await promise;
  await b.helpers.editOriginalInteractionResponse(interaction.token, {
    content,
  });
};

const applicationCommands = Array.from(commandMap.values()).map(
  ({ applicationCommand }) => applicationCommand
);

await bot.helpers.upsertGuildApplicationCommands(
  DISCORD_GUILD_ID,
  applicationCommands
);

await startBot(bot);

// TODO: post to audit log channel, try to delete message after a while, and if it succeeds, show error message and exit
