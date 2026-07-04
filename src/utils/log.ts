type Level = "info" | "warn" | "error" | "stage";

function fmt(level: Level, msg: string): string {
  const tag =
    level === "stage"
      ? "•"
      : level === "info"
        ? "·"
        : level === "warn"
          ? "!"
          : "x";
  return `[${tag}] ${msg}`;
}

export function info(msg: string): void {
  console.log(fmt("info", msg));
}
export function stage(msg: string): void {
  console.log(fmt("stage", msg));
}
export function warn(msg: string): void {
  console.error(fmt("warn", msg));
}
export function error(msg: string): void {
  console.error(fmt("error", msg));
}
