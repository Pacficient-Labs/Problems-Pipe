interface CacheEntry<V> {
  value: V;
  key: string;
  prev: CacheEntry<V> | null;
  next: CacheEntry<V> | null;
}

export class LRUCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private head: CacheEntry<V> | null = null;
  private tail: CacheEntry<V> | null = null;

  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.moveToHead(entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    const entry: CacheEntry<V> = { value, key, prev: null, next: null };
    this.map.set(key, entry);
    this.addToHead(entry);

    if (this.map.size > this.maxSize) {
      this.evict();
    }
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.removeEntry(entry);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.map.size;
  }

  private moveToHead(entry: CacheEntry<V>): void {
    if (entry === this.head) return;
    this.removeEntry(entry);
    this.addToHead(entry);
  }

  private addToHead(entry: CacheEntry<V>): void {
    entry.prev = null;
    entry.next = this.head;
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    this.tail ??= entry;
  }

  private removeEntry(entry: CacheEntry<V>): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }
    entry.prev = null;
    entry.next = null;
  }

  private evict(): void {
    if (!this.tail) return;
    const evicted = this.tail;
    this.removeEntry(evicted);
    this.map.delete(evicted.key);
  }
}
