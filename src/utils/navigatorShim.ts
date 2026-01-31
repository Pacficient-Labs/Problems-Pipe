type NavigatorLike = {
  userAgent?: string;
};

export function defineNavigatorShim(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  if (descriptor) {
    if (descriptor.get || descriptor.set) {
      // Replace accessor-based navigator to avoid VS Code's PendingMigrationError warning.
      try {
        Object.defineProperty(globalThis, "navigator", {
          value: { userAgent: "node" } satisfies NavigatorLike,
          configurable: true,
          enumerable: true,
          writable: false,
        });
      } catch {
        // Best-effort only; ignore if we can't redefine.
      }
    }
    return;
  }

  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "node" } satisfies NavigatorLike,
      configurable: true,
      enumerable: true,
      writable: false,
    });
  } catch {
    // Best-effort only; ignore if we can't define.
  }
}
