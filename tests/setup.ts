if (typeof window !== 'undefined') {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

if (typeof window !== 'undefined') {
  // jsdom has no layout engine or native dialog top layer.
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const dialog = window.HTMLDialogElement.prototype
  dialog.showModal ??= function () { this.open = true }
  dialog.close ??= function () { this.open = false }
}
