import { describe, it, expect } from "vitest";
import { LRUCache } from "../../src/utils/cache.js";

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache<number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });

  it("returns undefined for missing keys", () => {
    const cache = new LRUCache<number>(10);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("tracks size", () => {
    const cache = new LRUCache<number>(10);
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    expect(cache.size).toBe(1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("evicts least-recently-used entry when full", () => {
    const cache = new LRUCache<number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Cache is full. Adding "d" should evict "a" (oldest).
    cache.set("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("accessing a key promotes it so it is not evicted", () => {
    const cache = new LRUCache<number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Touch "a" so it becomes most-recently-used
    cache.get("a");

    // Add "d" — should evict "b" (now the oldest)
    cache.set("d", 4);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  it("updates value of existing key without changing size", () => {
    const cache = new LRUCache<number>(3);
    const keyA = "a";
    const keyB = "b";

    cache.set(keyA, 1);
    cache.set(keyB, 2);
    cache.set(keyA, 10); // NOSONAR - updating existing key is intentional

    expect(cache.size).toBe(2);
    expect(cache.get(keyA)).toBe(10);
  });

  it("updating existing key promotes it", () => {
    const cache = new LRUCache<number>(3);
    const keyA = "a";
    const keyB = "b";
    const keyC = "c";
    const keyD = "d";

    cache.set(keyA, 1);
    cache.set(keyB, 2);
    cache.set(keyC, 3);

    // Update "a" — promotes it
    cache.set(keyA, 100); // NOSONAR - updating existing key is intentional

    // Add "d" — should evict "b"
    cache.set(keyD, 4);

    expect(cache.get(keyA)).toBe(100);
    expect(cache.get(keyB)).toBeUndefined();
  });

  it("deletes entries", () => {
    const cache = new LRUCache<number>(10);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.delete("a")).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("delete returns false for missing key", () => {
    const cache = new LRUCache<number>(10);
    expect(cache.delete("nope")).toBe(false);
  });

  it("clears all entries", () => {
    const cache = new LRUCache<number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("works with maxSize of 1", () => {
    const cache = new LRUCache<string>(1);
    cache.set("a", "first");
    expect(cache.get("a")).toBe("first");

    cache.set("b", "second");
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("second");
  });

  it("handles delete of head, middle, and tail entries", () => {
    const cache = new LRUCache<number>(10);
    cache.set("a", 1); // tail after subsequent inserts
    cache.set("b", 2); // middle
    cache.set("c", 3); // head

    // Delete head
    cache.delete("c");
    expect(cache.size).toBe(2);

    // Re-add and delete tail
    cache.set("c", 3);
    cache.delete("a");
    expect(cache.size).toBe(2);

    // Delete middle
    cache.set("a", 1);
    cache.delete("c");
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("a")).toBe(1);
  });
});
