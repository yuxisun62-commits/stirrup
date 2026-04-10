import type { CommandModule } from "yargs";
import { execFile } from "node:child_process";
import { authenticateGithub } from "../../auth/github.js";
import { listTokens, removeToken, getTokenStoreLocation } from "../../auth/tokenStore.js";
import { heading, success, error, info } from "../output.js";

export const authCommand: CommandModule = {
  command: "auth <subcommand>",
  describe: "Authenticate with third-party services (GitHub, etc.)",
  builder: (yargs) =>
    yargs
      .command({
        command: "login <service>",
        describe: "Log in to a service (github)",
        builder: (y) =>
          y
            .positional("service", {
              type: "string",
              describe: "Service to authenticate with",
              choices: ["github"],
              demandOption: true,
            })
            .option("scope", {
              type: "string",
              default: "repo read:org",
              describe: "OAuth scope",
            }),
        handler: async (argv) => {
          const service = argv.service as string;
          const scope = argv.scope as string;

          if (service === "github") {
            heading("GitHub Authentication");
            try {
              const result = await authenticateGithub(
                scope,
                (deviceCode) => {
                  info("");
                  info(`First, copy this one-time code: ${deviceCode.user_code}`);
                  info(`Then visit: ${deviceCode.verification_uri}`);
                  info("");
                  info("Opening your browser...");
                  tryOpenBrowser(deviceCode.verification_uri);
                  info("Waiting for authorization...");
                },
                (status) => {
                  // Optional: could log progress
                  void status;
                }
              );
              success(`Authenticated as ${result.user.login}`);
              info(`  Token stored in ${getTokenStoreLocation()}`);
            } catch (err) {
              error(err instanceof Error ? err.message : String(err));
              process.exit(1);
            }
          }
        },
      })
      .command({
        command: "list",
        describe: "List authenticated services",
        handler: () => {
          const tokens = listTokens();
          if (tokens.length === 0) {
            info("No authenticated services. Run: stirrup auth login <service>");
            return;
          }
          heading("Authenticated Services");
          for (const t of tokens) {
            const expires = t.expiresAt ? ` (expires ${new Date(t.expiresAt).toLocaleDateString()})` : "";
            info(`  ${t.service}${t.userName ? ` as ${t.userName}` : ""}${expires}`);
          }
          info("");
          info(`Tokens stored in: ${getTokenStoreLocation()}`);
        },
      })
      .command({
        command: "logout <service>",
        describe: "Remove stored credentials for a service",
        builder: (y) =>
          y.positional("service", {
            type: "string",
            describe: "Service to log out from",
            demandOption: true,
          }),
        handler: (argv) => {
          const service = argv.service as string;
          const removed = removeToken(service);
          if (removed) {
            success(`Logged out of ${service}`);
          } else {
            info(`No stored credentials for ${service}`);
          }
        },
      })
      .demandCommand(1),
  handler: () => {},
};

function tryOpenBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url]);
    } else if (process.platform === "darwin") {
      execFile("open", [url]);
    } else {
      execFile("xdg-open", [url]);
    }
  } catch {
    // Ignore — user can copy the URL manually
  }
}
