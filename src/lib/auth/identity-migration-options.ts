export function parseIdentitySeedOptions(args: string[]) {
  const projectArgs = args.filter(arg => arg.startsWith("--project-id="));
  const confirmation = args.filter(arg => arg === "--confirm=SEED_AUTH_IDENTITY_KEYS");
  const modes = args.filter(arg => arg === "--dry-run" || arg === "--apply");
  if (args.length !== 3 || projectArgs.length !== 1 || confirmation.length !== 1 || modes.length !== 1) {
    throw new Error("Explicit project, seed confirmation and one mode are required.");
  }
  const projectId = projectArgs[0].slice("--project-id=".length);
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(projectId)) throw new Error("Invalid project ID.");
  return { projectId, dryRun: modes[0] === "--dry-run" };
}
