export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Недопустимый переход статуса: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Throws InvalidTransitionError unless `to` is in the allowed list for `from`. */
export function assertTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T,
): void {
  const allowed = transitions[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
