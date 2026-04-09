import chalk from "chalk";

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pending: chalk.gray,
  running: chalk.blue,
  paused: chalk.yellow,
  completed: chalk.green,
  failed: chalk.red,
  skipped: chalk.dim,
};

export function statusBadge(status: string): string {
  const colorize = STATUS_COLORS[status] ?? chalk.white;
  return colorize(`[${status.toUpperCase()}]`);
}

export function heading(text: string): void {
  console.log(chalk.bold.cyan(`\n${text}\n`));
}

export function info(text: string): void {
  console.log(chalk.gray(text));
}

export function success(text: string): void {
  console.log(chalk.green(`✓ ${text}`));
}

export function error(text: string): void {
  console.error(chalk.red(`✗ ${text}`));
}

export function table(rows: string[][]): void {
  if (rows.length === 0) return;
  const colWidths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => (row[i] ?? "").length))
  );
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i] + 2)).join(""));
  }
}
