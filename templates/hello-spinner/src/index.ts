// {{displayName}} — entrypoint loaded by the Weaver.
//
// One capability — `greet` — that returns a deterministic greeting.
// The minimal I-P-O atom for the Spinner shape.

export interface GreetInput {
  readonly name: string;
  readonly salutation?: string;
}

export interface GreetOutput {
  readonly greeting: string;
  readonly greetedAt: string;
}

export function greet(input: GreetInput): GreetOutput {
  const salutation = input.salutation ?? 'Hello';
  return {
    greeting: `${salutation}, ${input.name}`,
    greetedAt: new Date().toISOString(),
  };
}

// The Weaver dispatches to this module via the manifest's
// `entrypoint`. The bootstrap-epoch Weaver maps the capability name
// 'greet' onto the function above. Once dynamic dispatch lands,
// every capability declared in manifest.json is auto-wired by name.
export default { greet };
