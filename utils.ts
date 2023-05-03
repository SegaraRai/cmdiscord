export function prettyArg(arg: string) {
  return /[\s"]|^$/.test(arg) ? JSON.stringify(arg) : arg;
}

export function prettyArgs(args: readonly string[]) {
  return args.map(prettyArg).join(" ");
}

export function splitCommands(command: string): string[] {
  const args = command.match(/(?:"(?:[^"\\]|\\.)*"|(?:\\ |[^\s])+)+/g);
  if (!args) {
    return [];
  }
  return args.map((arg) => {
    const qb = arg.startsWith('"');
    const qe = arg.endsWith('"');
    if (qb !== qe) {
      throw new Error("Unmatched quote.");
    }
    if (qb && qe) {
      return arg.slice(1, -1).replace(/\\(.)/, "$1");
    }
    return arg.replaceAll("\\ ", " ");
  });
}

export function formatCommand(
  command: string,
  getValue: (key: string) => string
): string {
  return command.replace(/{([^}]+)}/g, (_, key) => getValue(key));
}

export function formatOutput(
  template: string,
  stdout: string,
  stderr: string,
  command: string
): string {
  return template
    .replaceAll("{command}", command)
    .replaceAll("{output}", `${stderr}\n${stdout}`.trim())
    .replaceAll("{stdout}", stdout)
    .replaceAll("{stderr}", stderr);
}
