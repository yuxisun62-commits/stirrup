import vm from "node:vm";

/**
 * Execute code in a hardened vm context.
 *
 * IMPORTANT: Node.js vm module is NOT a true security sandbox.
 * It provides scope isolation, not privilege isolation.
 * For untrusted code, use isolated-vm or a subprocess.
 *
 * This helper applies mitigations that block the most common
 * prototype-chain escape techniques, but cannot guarantee
 * full containment against a determined attacker.
 */
export function runInSandbox(
  code: string,
  sandbox: Record<string, unknown>,
  options: { timeout?: number } = {}
): unknown {
  // Freeze common prototype chain escape vectors
  const frozenSandbox = vm.createContext(Object.create(null));

  // Copy sandbox values into the frozen context
  for (const [key, value] of Object.entries(sandbox)) {
    frozenSandbox[key] = value;
  }

  // Block prototype chain access by overriding constructors
  vm.runInContext(
    `
    Object.defineProperty(Object.prototype, 'constructor', { get: () => undefined, configurable: false });
    `,
    frozenSandbox
  );

  return vm.runInContext(code, frozenSandbox, {
    timeout: options.timeout ?? 5000,
    breakOnSigint: true,
  });
}
