/**
 * An async iterable fed by `push`. The Agent SDK reads the session's prompt from one of
 * these, so chat messages, annotations and pipeline instructions can arrive at any time.
 * Iteration waits while the queue is empty and ends after `close()` once it has drained.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): boolean {
    if (this.closed) return false;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: item, done: false });
    } else this.items.push(item);
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined, done: true });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get size(): number {
    return this.items.length;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        if (this.waiting) return Promise.reject(new Error('AsyncQueue supports one reader'));
        return new Promise((resolve) => (this.waiting = resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
