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
  // Contextify the sandbox object IN PLACE. Using vm.createContext on the
  // sandbox directly (rather than copying into a fresh Object.create(null))
  // means mutations the script makes to sandbox properties propagate back
  // to the caller's reference. This is essential for ScriptNode, which
  // does `result = { ... }` inside the script and needs to read that
  // assignment back after the call. TransformNode and ConditionNode only
  // care about the return value (the last-expression value), so they're
  // unaffected by this semantic change — previously their copy-based
  // isolation was redundant since they never read back from sandbox.
  const ctx = vm.createContext(sandbox);

  // Block common prototype-chain escape vectors inside the vm realm.
  // This mitigation targets Object.prototype.constructor, which attackers
  // use to reach Function and construct arbitrary code. It applies inside
  // the context's own realm regardless of what the sandbox object's own
  // prototype is.
  vm.runInContext(
    `Object.defineProperty(Object.prototype, 'constructor', { get: () => undefined, configurable: false });`,
    ctx
  );

  return vm.runInContext(code, ctx, {
    timeout: options.timeout ?? 5000,
    breakOnSigint: true,
  });
}
