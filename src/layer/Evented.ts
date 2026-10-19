type Listener<T> = (event: T) => void;

/** 型付きの小さなイベントエミッタ */
export class Evented<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): this {
    (this.listeners[type] ??= new Set()).add(listener);
    return this;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): this {
    this.listeners[type]?.delete(listener);
    return this;
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): this {
    const wrapped: Listener<Events[K]> = (e) => {
      this.off(type, wrapped);
      listener(e);
    };
    return this.on(type, wrapped);
  }

  protected listens(type: keyof Events): boolean {
    return (this.listeners[type]?.size ?? 0) > 0;
  }

  protected fire<K extends keyof Events>(type: K, event: Events[K]): void {
    for (const l of [...(this.listeners[type] ?? [])]) l(event);
  }
}
