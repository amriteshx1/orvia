export class LimitError extends Error {
  readonly code = "conflict";

  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

export class JobRetry extends Error {
  constructor() {
    super("retry");
    this.name = "JobRetry";
  }
}

export class LeaseLost extends Error {
  constructor() {
    super("lease lost");
    this.name = "LeaseLost";
  }
}

export class EffectUncertain extends Error {
  readonly code = "effect_uncertain";

  constructor() {
    super("effect uncertain");
    this.name = "EffectUncertain";
  }
}

export class EffectFailed extends Error {
  readonly code = "effect_failed";

  constructor() {
    super("effect failed");
    this.name = "EffectFailed";
  }
}

export class EffectRetry extends Error {
  readonly code = "effect_retry";

  constructor() {
    super("effect retry");
    this.name = "EffectRetry";
  }
}

export class BudgetStopped extends Error {
  readonly code = "budget_exceeded";

  constructor() {
    super("budget exceeded");
    this.name = "BudgetStopped";
  }
}

export const LOST = Symbol("lost-lease");
